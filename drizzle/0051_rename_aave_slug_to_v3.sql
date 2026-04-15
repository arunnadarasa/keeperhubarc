-- Rename Aave V3 protocol slug from "aave" to "aave-v3" so it coexists
-- cleanly with the new "aave-v4" slug. Data-only migration: no schema change.
--
-- Affects:
--   * workflows.featured_protocol (text column)
--   * workflows.nodes (jsonb): each node's data.config.actionType ("aave/*")
--     and the stringified data.config._protocolMeta.protocolSlug ("aave")
--
-- Strategy: text-level REPLACE on the canonical JSONB text rendition, then
-- cast back. Two distinct patterns exist:
--
-- (1) Top-level JSONB fields: PostgreSQL canonicalizes with a space after
--     the colon, so the actionType field renders as "actionType": "aave/...".
--
-- (2) The _protocolMeta value is itself a stringified JSON produced by
--     JSON.stringify() on the client. Default JSON.stringify output has NO
--     space after colons, so within that string the pattern is
--     \"protocolSlug\":\"aave\" (escaped quotes, no spaces).
--
-- These patterns are key-scoped so free-form text containing the word "aave"
-- (e.g. a description field) is untouched.
--
-- LIKE-escape note: LIKE treats backslash as its own escape character by
-- default. To match a literal backslash-quote sequence in the text form we
-- must double the backslashes in the LIKE pattern (so '\\"' after string
-- literal parsing becomes '\\"' which LIKE processes as \ + ") -- mirroring
-- the pattern used in 0048_rename_weth_to_wrapped.sql. REPLACE has no such
-- escape processing, so the REPLACE patterns keep single backslashes.

UPDATE workflows
SET featured_protocol = 'aave-v3'
WHERE featured_protocol = 'aave';
--> statement-breakpoint

UPDATE workflows
SET nodes = REPLACE(
  REPLACE(
    nodes::text,
    '"actionType": "aave/',
    '"actionType": "aave-v3/'
  ),
  '\"protocolSlug\":\"aave\"',
  '\"protocolSlug\":\"aave-v3\"'
)::jsonb
WHERE
  nodes::text LIKE '%"actionType": "aave/%'
  OR nodes::text LIKE '%\\"protocolSlug\\":\\"aave\\"%';
