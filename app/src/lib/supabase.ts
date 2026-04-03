import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lciqjfeyldhfoihsyyvwn.supabase.co';
const supabaseAnonKey =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjaWdqZmV5bGRoZm9paHN5dnduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTI2NDgsImV4cCI6MjA5MDc4ODY0OH0.ef9_p8BmNyFf5h1dOa2_HZMzuKMC6br0yYK8HG9z7Rk';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
