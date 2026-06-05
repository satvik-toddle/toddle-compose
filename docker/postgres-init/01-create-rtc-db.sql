-- Runs once on first container init (empty data volume). The main database
-- (toddle_compose) is created by POSTGRES_DB; this adds the separate, write-heavy
-- RTC database so both exist out of the box.
CREATE DATABASE toddle_compose_rtc;
