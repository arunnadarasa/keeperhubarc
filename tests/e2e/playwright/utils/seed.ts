import { randomBytes, scrypt } from "node:crypto";
import type postgres from "postgres";
import { getDbConnection } from "./connection";

// ---------------------------------------------------------------------------
// Password hashing (scrypt, compatible with Better Auth / @noble/hashes/scrypt)
// ---------------------------------------------------------------------------

const SCRYPT_CONFIG = { N: 16_384, r: 16, p: 1, dkLen: 64 } as const;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function scryptAsync(
  password: string,
  salt: string,
  keylen: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keylen,
      {
        N: SCRYPT_CONFIG.N,
        r: SCRYPT_CONFIG.r,
        p: SCRYPT_CONFIG.p,
        maxmem: 128 * SCRYPT_CONFIG.N * SCRYPT_CONFIG.r * 2,
      },
      (err, derivedKey) => {
        if (err) {
          reject(err);
        } else {
          resolve(derivedKey);
        }
      }
    );
  });
}

async function hashPassword(password: string): Promise<string> {
  const saltBytes = randomBytes(16);
  const salt = bytesToHex(saltBytes);
  const key = await scryptAsync(
    password.normalize("NFKC"),
    salt,
    SCRYPT_CONFIG.dkLen
  );
  return `${salt}:${bytesToHex(key)}`;
}

// ---------------------------------------------------------------------------
// ID generation (lowercase alphanumeric, 21 chars)
// ---------------------------------------------------------------------------

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 21;

function generateId(): string {
  const bytes = randomBytes(ID_LENGTH);
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return id;
}

// ---------------------------------------------------------------------------
// Test user definitions
// ---------------------------------------------------------------------------

const TEST_PASSWORD = "TestPassword123!";

type TestUserConfig = {
  email: string;
  name: string;
  orgSlug: string;
  orgName: string;
};

const PERSISTENT_USERS: TestUserConfig[] = [
  {
    email: "pr-test-do-not-delete@techops.services",
    name: "E2E Test User",
    orgSlug: "e2e-test-org",
    orgName: "E2E Test Organization",
  },
  {
    email: "pr-test-inviter@techops.services",
    name: "E2E Inviter",
    orgSlug: "e2e-test-inviter-org",
    orgName: "E2E Inviter Organization",
  },
  {
    email: "pr-test-member@techops.services",
    name: "E2E Member",
    orgSlug: "e2e-test-member-org",
    orgName: "E2E Member Organization",
  },
  {
    email: "pr-test-bystander@techops.services",
    name: "E2E Bystander",
    orgSlug: "e2e-test-bystander-org",
    orgName: "E2E Bystander Organization",
  },
];

const PERSISTENT_EMAILS = PERSISTENT_USERS.map((u) => u.email);

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function ensureUser(
  sql: ReturnType<typeof postgres>,
  email: string,
  name: string
): Promise<string> {
  const existing = await sql`
    SELECT id FROM users WHERE email = ${email} LIMIT 1
  `;
  if (existing.length > 0) {
    return existing[0].id as string;
  }

  const id = generateId();
  const now = new Date();
  await sql`
    INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
    VALUES (${id}, ${name}, ${email}, true, ${now}, ${now})
  `;
  return id;
}

async function ensureCredentialAccount(
  sql: ReturnType<typeof postgres>,
  userId: string,
  password: string
): Promise<void> {
  const existing = await sql`
    SELECT id FROM accounts
    WHERE user_id = ${userId} AND provider_id = 'credential'
    LIMIT 1
  `;
  if (existing.length > 0) {
    return;
  }

  const hashedPassword = await hashPassword(password);
  const now = new Date();
  await sql`
    INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
    VALUES (${generateId()}, ${userId}, 'credential', ${userId}, ${hashedPassword}, ${now}, ${now})
  `;
}

async function ensureOrganization(
  sql: ReturnType<typeof postgres>,
  slug: string,
  name: string
): Promise<string> {
  const existing = await sql`
    SELECT id FROM organization WHERE slug = ${slug} LIMIT 1
  `;
  if (existing.length > 0) {
    return existing[0].id as string;
  }

  const id = generateId();
  await sql`
    INSERT INTO organization (id, name, slug, created_at)
    VALUES (${id}, ${name}, ${slug}, ${new Date()})
  `;
  return id;
}

async function ensureMembership(
  sql: ReturnType<typeof postgres>,
  userId: string,
  orgId: string,
  role: string
): Promise<void> {
  const existing = await sql`
    SELECT id FROM member
    WHERE user_id = ${userId} AND organization_id = ${orgId}
    LIMIT 1
  `;
  if (existing.length > 0) {
    return;
  }

  await sql`
    INSERT INTO member (id, organization_id, user_id, role, created_at)
    VALUES (${generateId()}, ${orgId}, ${userId}, ${role}, ${new Date()})
  `;
}

// ---------------------------------------------------------------------------
// Public: seedPersistentTestUsers
// ---------------------------------------------------------------------------

export async function seedPersistentTestUsers(): Promise<void> {
  const sql = getDbConnection();
  try {
    const results: Array<{ userId: string; orgId: string }> = [];

    for (const config of PERSISTENT_USERS) {
      const userId = await ensureUser(sql, config.email, config.name);
      await ensureCredentialAccount(sql, userId, TEST_PASSWORD);
      const orgId = await ensureOrganization(
        sql,
        config.orgSlug,
        config.orgName
      );
      await ensureMembership(sql, userId, orgId, "owner");
      results.push({ userId, orgId });
    }

    // Cross-org: member (index 2) is a member of inviter's org (index 1)
    const inviter = results[1];
    const member = results[2];
    await ensureMembership(sql, member.userId, inviter.orgId, "member");
  } finally {
    await sql.end();
  }
}

// ---------------------------------------------------------------------------
// Public: cleanupPersistentTestUsers
// ---------------------------------------------------------------------------

export async function cleanupPersistentTestUsers(): Promise<void> {
  const sql = getDbConnection();
  try {
    const testUsers = await sql`
      SELECT id FROM users WHERE email IN ${sql(PERSISTENT_EMAILS)}
    `;
    if (testUsers.length === 0) {
      return;
    }

    const userIds = testUsers.map((u) => u.id as string);

    const ownedOrgs = await sql`
      SELECT DISTINCT organization_id AS id FROM member
      WHERE user_id IN ${sql(userIds)} AND role = 'owner'
    `;
    const orgIds = ownedOrgs.map((o) => o.id as string);

    // Collect workflows owned by persistent users OR in their orgs
    // (org deletion cascades to workflows, but executions block that cascade)
    const workflowQuery =
      orgIds.length > 0
        ? sql`
          SELECT id FROM workflows
          WHERE user_id IN ${sql(userIds)}
             OR organization_id IN ${sql(orgIds)}
        `
        : sql`SELECT id FROM workflows WHERE user_id IN ${sql(userIds)}`;
    const testWorkflows = await workflowQuery;
    const workflowIds = testWorkflows.map((w) => w.id as string);

    // 1. Workflow data
    if (workflowIds.length > 0) {
      await sql`
        DELETE FROM workflow_execution_logs WHERE execution_id IN (
          SELECT id FROM workflow_executions WHERE workflow_id IN ${sql(workflowIds)}
        )
      `;
      await sql`DELETE FROM workflow_executions WHERE workflow_id IN ${sql(workflowIds)}`;
      await sql`DELETE FROM workflow_schedules WHERE workflow_id IN ${sql(workflowIds)}`;
      await sql`DELETE FROM workflows WHERE id IN ${sql(workflowIds)}`;
    }

    // 2. Para wallets (DB only, no API cleanup needed for seeded users)
    await sql`DELETE FROM para_wallets WHERE user_id IN ${sql(userIds)}`;

    // 3. Integrations, API keys, preferences
    await sql`DELETE FROM integrations WHERE user_id IN ${sql(userIds)}`;
    await sql`DELETE FROM api_keys WHERE user_id IN ${sql(userIds)}`;
    await sql`DELETE FROM user_rpc_preferences WHERE user_id IN ${sql(userIds)}`;

    if (orgIds.length > 0) {
      await sql`DELETE FROM address_book_entry WHERE organization_id IN ${sql(orgIds)}`;
      await sql`DELETE FROM organization_api_keys WHERE organization_id IN ${sql(orgIds)}`;
      await sql`DELETE FROM organization_tokens WHERE organization_id IN ${sql(orgIds)}`;
      await sql`DELETE FROM projects WHERE organization_id IN ${sql(orgIds)}`;
      await sql`DELETE FROM tags WHERE organization_id IN ${sql(orgIds)}`;
      await sql`DELETE FROM integrations WHERE organization_id IN ${sql(orgIds)}`;
    }

    // 4. Invitations
    if (orgIds.length > 0) {
      await sql`DELETE FROM invitation WHERE organization_id IN ${sql(orgIds)}`;
    }
    await sql`DELETE FROM invitation WHERE email IN ${sql(PERSISTENT_EMAILS)}`;

    // 5. Members
    if (orgIds.length > 0) {
      await sql`DELETE FROM member WHERE organization_id IN ${sql(orgIds)}`;
    }
    await sql`DELETE FROM member WHERE user_id IN ${sql(userIds)}`;

    // 6. Sessions and accounts
    await sql`DELETE FROM sessions WHERE user_id IN ${sql(userIds)}`;
    await sql`DELETE FROM accounts WHERE user_id IN ${sql(userIds)}`;

    // 7. Organizations
    if (orgIds.length > 0) {
      await sql`DELETE FROM organization WHERE id IN ${sql(orgIds)}`;
    }

    // 8. Users
    await sql`DELETE FROM users WHERE id IN ${sql(userIds)}`;

    // 9. Verifications
    await sql`
      DELETE FROM verifications
      WHERE identifier LIKE 'email-verification-otp-pr-test-%'
    `;
  } finally {
    await sql.end();
  }
}
