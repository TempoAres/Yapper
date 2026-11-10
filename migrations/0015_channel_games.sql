CREATE TABLE channel_game_records (
  channel_id TEXT NOT NULL,
  game TEXT NOT NULL CHECK (game IN ('wordchain', 'categories', 'counting')),
  score INTEGER NOT NULL CHECK (score >= 0),
  PRIMARY KEY (channel_id, game)
);
