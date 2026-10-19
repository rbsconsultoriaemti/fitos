import { Pool } from 'pg';
import { config } from '../shared/config';

export const pool = new Pool({ connectionString: config.databaseUrl });
