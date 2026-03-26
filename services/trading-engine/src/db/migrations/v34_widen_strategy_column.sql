-- v34: Widen strategy column in trade_decisions to support display names
ALTER TABLE trade_decisions ALTER COLUMN strategy TYPE VARCHAR(50);
