ALTER TABLE users
  ADD COLUMN photo_data LONGBLOB NULL AFTER photo,
  ADD COLUMN photo_mime VARCHAR(50) NULL AFTER photo_data;
