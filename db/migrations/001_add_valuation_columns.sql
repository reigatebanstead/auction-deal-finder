-- Add valuation tracking columns to lots table
ALTER TABLE lots
ADD COLUMN IF NOT EXISTS valuation_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS valuated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS condition_risks TEXT[],
ADD COLUMN IF NOT EXISTS valuation_error TEXT;

-- Add CHECK constraint to valuation_status
ALTER TABLE lots
ADD CONSTRAINT check_valuation_status CHECK (
    valuation_status IN ('pending', 'complete', 'failed')
);

-- Create index for faster filtering of pending lots
CREATE INDEX IF NOT EXISTS idx_lots_valuation_status ON lots(valuation_status);
