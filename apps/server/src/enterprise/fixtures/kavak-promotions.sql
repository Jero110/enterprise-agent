CREATE SCHEMA sales;

CREATE TABLE sales.promotions (
  id integer PRIMARY KEY,
  partner text NOT NULL,
  campaign_name text NOT NULL,
  discount_percent numeric(5, 2) NOT NULL CHECK (discount_percent BETWEEN 0 AND 100),
  started_on date NOT NULL,
  ended_on date NOT NULL CHECK (ended_on >= started_on)
);

INSERT INTO sales.promotions (id, partner, campaign_name, discount_percent, started_on, ended_on)
VALUES (1, 'Kavak', 'Past Kavak campaign', 5.00, '2025-10-01', '2025-10-31');
