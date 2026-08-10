-- Migration: Add last_read_at column to conversation_participants
-- For tracking unread messages

-- PostgreSQL version
ALTER TABLE conversation_participants 
ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMP;

-- Create index for faster unread queries
CREATE INDEX IF NOT EXISTS idx_conv_part_last_read 
ON conversation_participants(conversation_id, user_id, last_read_at);

-- Create index on messages for unread counting
CREATE INDEX IF NOT EXISTS idx_messages_conv_sender_created 
ON messages(conversation_id, sender_id, created_at);
