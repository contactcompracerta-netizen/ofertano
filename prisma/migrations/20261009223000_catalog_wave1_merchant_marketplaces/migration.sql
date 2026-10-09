-- Approved AWIN merchants are real stores/marketplaces; AWIN remains only the network/source.
ALTER TYPE "Marketplace" ADD VALUE IF NOT EXISTS 'CAMA_IN_BOX';
ALTER TYPE "Marketplace" ADD VALUE IF NOT EXISTS 'OLYMPIKUS';
ALTER TYPE "Marketplace" ADD VALUE IF NOT EXISTS 'LEVEROS';
