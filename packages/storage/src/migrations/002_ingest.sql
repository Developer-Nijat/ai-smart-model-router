-- 002_ingest: what the agent integration reports about each turn.
-- verified: the agent reported usage for the turn (applied/failed could be checked).
-- steps: how many model requests the turn made.

ALTER TABLE routing_decisions ADD COLUMN verified INTEGER CHECK (verified IS NULL OR verified IN (0, 1));
ALTER TABLE routing_decisions ADD COLUMN steps INTEGER CHECK (steps IS NULL OR steps >= 0);

CREATE INDEX idx_usage_records_decision ON usage_records (decision_id);
CREATE INDEX idx_routing_decisions_status ON routing_decisions (status, created_at);
