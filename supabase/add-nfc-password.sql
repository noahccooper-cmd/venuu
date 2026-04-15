-- Add nfc_password column to venues table
ALTER TABLE venues ADD COLUMN nfc_password text;

COMMENT ON COLUMN venues.nfc_password IS 'Plain text password written to NFC NDEF text record. Server compares this to the password the client reads from the tag during NFC check-in.';

-- Set the NFC password for The Bookstore
UPDATE venues
SET nfc_password = 'TENNXyourMOM67-x9K2mQ7pL4nR8vT3'
WHERE id = '28a5a5cf-26a4-42b5-94e0-1c77e7c19c8e';
