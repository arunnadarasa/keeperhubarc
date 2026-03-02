-- seed-pr-data.sql
-- Populate PR environment DB with test workflows, execution history, org API key, and wallet.
-- Run via: psql $PR_DB_URL -v encrypted_user_share="'...'" -f scripts/pr-test/seed-pr-data.sql
--
-- IDEMPOTENT: Uses INSERT ... ON CONFLICT DO NOTHING throughout.
-- DETERMINISTIC: All IDs prefixed with 'pr-test-' for easy identification and cleanup.
--
-- PREREQUISITE: Init container must have already created:
--   - User: pr-test-do-not-delete@techops.services
--   - Organization: e2e-test-org
--   - Wallet, chains, tokens
--
-- PSQL VARIABLES (optional):
--   :encrypted_user_share - AES-256-GCM encrypted Para user share (iv:tag:data)
--                           If set to '__SKIP__' or unset, wallet seeding is skipped.

-- Pass the psql variable into a session setting so the DO block can read it.
-- psql does not expand :variables inside dollar-quoted ($$) blocks.
SELECT set_config('app.encrypted_user_share', :'encrypted_user_share', false);

DO $$
DECLARE
  v_user_id   text;
  v_org_id    text;
  v_now       timestamp := now();
  v_1h_ago    timestamp := now() - interval '1 hour';
  v_2h_ago    timestamp := now() - interval '2 hours';
  v_3h_ago    timestamp := now() - interval '3 hours';
  v_6h_ago    timestamp := now() - interval '6 hours';
  v_1d_ago    timestamp := now() - interval '1 day';
  v_key_hash  text;
BEGIN

  -- Look up the test user by email
  SELECT id INTO v_user_id
  FROM users
  WHERE email = 'pr-test-do-not-delete@techops.services';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Test user not found (pr-test-do-not-delete@techops.services). Init container may not have completed.';
  END IF;

  -- Look up the org via member table
  SELECT m.organization_id INTO v_org_id
  FROM member m
  WHERE m.user_id = v_user_id
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization not found for test user. Init container may not have completed.';
  END IF;

  -- Compute sha256 hash for org API key (PG 17+ has sha256 built-in; fall back to pre-computed for PG 16)
  BEGIN
    v_key_hash := encode(sha256('kh_prte_test_api_key_000'::bytea), 'hex');
  EXCEPTION WHEN undefined_function THEN
    -- Pre-computed sha256 of 'kh_prte_test_api_key_000'
    v_key_hash := '536f745256f98745a76e50d9dee021c88d36c2c7561a50eab61e0d53180353da';
  END;

  -------------------------------------------------------------------
  -- 1. WORKFLOWS (3)
  -------------------------------------------------------------------

  -- Workflow 1: Webhook trigger with HTTP Request action
  INSERT INTO workflows (id, name, description, user_id, organization_id, is_anonymous, featured, featured_order, nodes, edges, visibility, enabled, created_at, updated_at)
  VALUES (
    'pr-test-wf-webhook',
    'Webhook Price Alert',
    'Receives webhook and sends HTTP notification',
    v_user_id,
    v_org_id,
    false,
    false,
    0,
    '[{"id":"trigger-1","type":"trigger","position":{"x":100,"y":100},"data":{"type":"trigger","label":"Webhook Trigger","config":{"triggerType":"Webhook"}}},{"id":"action-1","type":"action","position":{"x":400,"y":100},"data":{"type":"action","label":"HTTP Request","config":{"actionType":"HTTP Request","endpoint":"https://httpbin.org/post","httpMethod":"POST","httpHeaders":"{}","httpBody":"{}"}}}]'::jsonb,
    '[{"id":"edge-trigger-1-action-1","source":"trigger-1","target":"action-1","type":"default"}]'::jsonb,
    'private',
    true,
    v_1d_ago,
    v_1h_ago
  )
  ON CONFLICT (id) DO NOTHING;

  -- Workflow 2: Schedule trigger with HTTP Request action
  INSERT INTO workflows (id, name, description, user_id, organization_id, is_anonymous, featured, featured_order, nodes, edges, visibility, enabled, created_at, updated_at)
  VALUES (
    'pr-test-wf-schedule',
    'Scheduled Balance Check',
    'Runs every hour to check balances',
    v_user_id,
    v_org_id,
    false,
    false,
    0,
    '[{"id":"trigger-1","type":"trigger","position":{"x":100,"y":100},"data":{"type":"trigger","label":"Schedule Trigger","config":{"triggerType":"Schedule","scheduleCron":"0 * * * *","scheduleTimezone":"UTC"}}},{"id":"action-1","type":"action","position":{"x":400,"y":100},"data":{"type":"action","label":"HTTP Request","config":{"actionType":"HTTP Request","endpoint":"https://httpbin.org/get","httpMethod":"GET","httpHeaders":"{}","httpBody":""}}}]'::jsonb,
    '[{"id":"edge-trigger-1-action-1","source":"trigger-1","target":"action-1","type":"default"}]'::jsonb,
    'private',
    true,
    v_1d_ago,
    v_3h_ago
  )
  ON CONFLICT (id) DO NOTHING;

  -- Workflow 3: Manual trigger with HTTP Request action
  INSERT INTO workflows (id, name, description, user_id, organization_id, is_anonymous, featured, featured_order, nodes, edges, visibility, enabled, created_at, updated_at)
  VALUES (
    'pr-test-wf-manual',
    'Manual Data Export',
    'Manually triggered data export workflow',
    v_user_id,
    v_org_id,
    false,
    false,
    0,
    '[{"id":"trigger-1","type":"trigger","position":{"x":100,"y":100},"data":{"type":"trigger","label":"Manual Trigger","config":{"triggerType":"Manual"}}},{"id":"action-1","type":"action","position":{"x":400,"y":100},"data":{"type":"action","label":"HTTP Request","config":{"actionType":"HTTP Request","endpoint":"https://httpbin.org/post","httpMethod":"POST","httpHeaders":"{}","httpBody":"{}"}}}]'::jsonb,
    '[{"id":"edge-trigger-1-action-1","source":"trigger-1","target":"action-1","type":"default"}]'::jsonb,
    'private',
    false,
    v_1d_ago,
    v_1d_ago
  )
  ON CONFLICT (id) DO NOTHING;

  -------------------------------------------------------------------
  -- 2. WORKFLOW SCHEDULE (1 for the schedule workflow)
  -------------------------------------------------------------------

  INSERT INTO workflow_schedules (id, workflow_id, cron_expression, timezone, enabled, last_run_at, last_status, next_run_at, run_count, created_at, updated_at)
  VALUES (
    'pr-test-schedule-1',
    'pr-test-wf-schedule',
    '0 * * * *',
    'UTC',
    true,
    v_1h_ago,
    'success',
    v_now + interval '1 hour',
    '24',
    v_1d_ago,
    v_1h_ago
  )
  ON CONFLICT (id) DO NOTHING;

  -------------------------------------------------------------------
  -- 3. WORKFLOW EXECUTIONS (6)
  -------------------------------------------------------------------

  -- Execution 1: Success on webhook workflow (oldest)
  INSERT INTO workflow_executions (id, workflow_id, user_id, status, input, output, started_at, completed_at, duration, total_steps, completed_steps, last_successful_node_id, last_successful_node_name, execution_trace)
  VALUES (
    'pr-test-exec-1',
    'pr-test-wf-webhook',
    v_user_id,
    'success',
    '{"webhookPayload":{"token":"ETH","price":2500}}'::jsonb,
    '{"statusCode":200,"body":"{\"success\":true}"}'::jsonb,
    v_6h_ago,
    v_6h_ago + interval '3 seconds',
    '3000',
    '2',
    '2',
    'action-1',
    'HTTP Request',
    '["trigger-1","action-1"]'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  -- Execution 2: Success on webhook workflow (recent)
  INSERT INTO workflow_executions (id, workflow_id, user_id, status, input, output, started_at, completed_at, duration, total_steps, completed_steps, last_successful_node_id, last_successful_node_name, execution_trace)
  VALUES (
    'pr-test-exec-2',
    'pr-test-wf-webhook',
    v_user_id,
    'success',
    '{"webhookPayload":{"token":"ETH","price":2600}}'::jsonb,
    '{"statusCode":200,"body":"{\"success\":true}"}'::jsonb,
    v_3h_ago,
    v_3h_ago + interval '2 seconds',
    '2000',
    '2',
    '2',
    'action-1',
    'HTTP Request',
    '["trigger-1","action-1"]'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  -- Execution 3: Success on schedule workflow
  INSERT INTO workflow_executions (id, workflow_id, user_id, status, input, output, started_at, completed_at, duration, total_steps, completed_steps, last_successful_node_id, last_successful_node_name, execution_trace)
  VALUES (
    'pr-test-exec-3',
    'pr-test-wf-schedule',
    v_user_id,
    'success',
    '{}'::jsonb,
    '{"statusCode":200,"body":"{\"balances\":{\"ETH\":\"1.5\"}}"}'::jsonb,
    v_2h_ago,
    v_2h_ago + interval '4 seconds',
    '4000',
    '2',
    '2',
    'action-1',
    'HTTP Request',
    '["trigger-1","action-1"]'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  -- Execution 4: Success on manual workflow
  INSERT INTO workflow_executions (id, workflow_id, user_id, status, input, output, started_at, completed_at, duration, total_steps, completed_steps, last_successful_node_id, last_successful_node_name, execution_trace)
  VALUES (
    'pr-test-exec-4',
    'pr-test-wf-manual',
    v_user_id,
    'success',
    '{}'::jsonb,
    '{"statusCode":200,"body":"{\"exported\":true}"}'::jsonb,
    v_1h_ago,
    v_1h_ago + interval '5 seconds',
    '5000',
    '2',
    '2',
    'action-1',
    'HTTP Request',
    '["trigger-1","action-1"]'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  -- Execution 5: Error on webhook workflow
  INSERT INTO workflow_executions (id, workflow_id, user_id, status, input, error, started_at, completed_at, duration, total_steps, completed_steps, current_node_id, current_node_name, last_successful_node_id, last_successful_node_name, execution_trace)
  VALUES (
    'pr-test-exec-5',
    'pr-test-wf-webhook',
    v_user_id,
    'error',
    '{"webhookPayload":{"token":"ETH","price":2700}}'::jsonb,
    'HTTP Request failed: 502 Bad Gateway',
    v_1h_ago,
    v_1h_ago + interval '10 seconds',
    '10000',
    '2',
    '1',
    'action-1',
    'HTTP Request',
    'trigger-1',
    'Webhook Trigger',
    '["trigger-1","action-1"]'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  -- Execution 6: Running on schedule workflow (in progress)
  INSERT INTO workflow_executions (id, workflow_id, user_id, status, input, started_at, total_steps, completed_steps, current_node_id, current_node_name, last_successful_node_id, last_successful_node_name, execution_trace)
  VALUES (
    'pr-test-exec-6',
    'pr-test-wf-schedule',
    v_user_id,
    'running',
    '{}'::jsonb,
    v_now - interval '30 seconds',
    '2',
    '1',
    'action-1',
    'HTTP Request',
    'trigger-1',
    'Schedule Trigger',
    '["trigger-1"]'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  -------------------------------------------------------------------
  -- 4. EXECUTION LOGS (2 for the first successful execution)
  -------------------------------------------------------------------

  -- Log 1: Trigger node for execution 1
  INSERT INTO workflow_execution_logs (id, execution_id, node_id, node_name, node_type, status, input, output, started_at, completed_at, duration, "timestamp")
  VALUES (
    'pr-test-log-1',
    'pr-test-exec-1',
    'trigger-1',
    'Webhook Trigger',
    'trigger',
    'success',
    '{"webhookPayload":{"token":"ETH","price":2500}}'::jsonb,
    '{"token":"ETH","price":2500}'::jsonb,
    v_6h_ago,
    v_6h_ago + interval '100 milliseconds',
    '100',
    v_6h_ago
  )
  ON CONFLICT (id) DO NOTHING;

  -- Log 2: Action node for execution 1
  INSERT INTO workflow_execution_logs (id, execution_id, node_id, node_name, node_type, status, input, output, started_at, completed_at, duration, "timestamp")
  VALUES (
    'pr-test-log-2',
    'pr-test-exec-1',
    'action-1',
    'HTTP Request',
    'action',
    'success',
    '{"endpoint":"https://httpbin.org/post","method":"POST"}'::jsonb,
    '{"statusCode":200,"body":"{\"success\":true}"}'::jsonb,
    v_6h_ago + interval '100 milliseconds',
    v_6h_ago + interval '3 seconds',
    '2900',
    v_6h_ago + interval '100 milliseconds'
  )
  ON CONFLICT (id) DO NOTHING;

  -------------------------------------------------------------------
  -- 5. ORG API KEY (1)
  -------------------------------------------------------------------

  INSERT INTO organization_api_keys (id, organization_id, name, key_hash, key_prefix, created_by, created_at)
  VALUES (
    'pr-test-orgapikey-1',
    v_org_id,
    'PR Test API Key',
    v_key_hash,
    'kh_prte',
    v_user_id,
    v_1d_ago
  )
  ON CONFLICT (id) DO NOTHING;

  -------------------------------------------------------------------
  -- 6. WALLET + WEB3 INTEGRATION (conditional on :encrypted_user_share)
  -------------------------------------------------------------------

  IF current_setting('app.encrypted_user_share', true) IS DISTINCT FROM '__SKIP__' THEN
    INSERT INTO para_wallets (id, user_id, organization_id, email, wallet_id, wallet_address, user_share, created_at)
    VALUES (
      'pr-test-wallet-1',
      v_user_id,
      v_org_id,
      'pr-test-do-not-delete@techops.services',
      '3b1acc96-170f-4148-800b-7bca3e2ee6ad',
      '0x4f1089424dcf25b1290631df483a436b320e51a1',
      current_setting('app.encrypted_user_share', true),
      v_1d_ago
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO integrations (id, user_id, organization_id, name, type, config, created_at, updated_at)
    VALUES (
      'pr-test-integration-web3',
      v_user_id,
      v_org_id,
      'Web3 Wallet',
      'web3',
      '{"walletAddress":"0x4f1089424dcf25b1290631df483a436b320e51a1"}'::jsonb,
      v_1d_ago,
      v_1d_ago
    )
    ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE 'Wallet + web3 integration seeded';
  ELSE
    RAISE NOTICE 'Skipping wallet seed (encrypted_user_share not provided)';
  END IF;

  -------------------------------------------------------------------
  -- Done
  -------------------------------------------------------------------

  RAISE NOTICE 'Seed complete: user=%, org=%, 3 workflows, 1 schedule, 6 executions, 2 logs, 1 org API key', v_user_id, v_org_id;

END $$;
