-- numeric(10,2) stored 500 mg (0.0011 lb) as 0.00 and 1 ct as 0.08 dozen -> 0.96 ct,
-- and overflowed above 99,999,999 (see miple-testdata large5/quantity_regression).
-- The server now clamps quantities to (0, 10000] with 3 decimals; this lets the column hold them.
alter table public.items alter column quantity type numeric(14, 3);
