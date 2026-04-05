import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lcigjfeyldhfoihsyvwn.supabase.co';
const supabaseAnonKey =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjaWdqZmV5bGRoZm9paHN5dnduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMTI2NDgsImV4cCI6MjA5MDc4ODY0OH0.ef9_p8BmNyFf5h1dOa2_HZMzuKMC6br0yYK8HG9z7Rk';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function signInWithGoogle() {
	const { error } = await supabase.auth.signInWithOAuth({
		provider: 'google',
		options: {
			redirectTo: window.location.origin + '/auth/callback'
		}
	});
	if (error) throw error;
}

export async function signOut() {
	const { error } = await supabase.auth.signOut();
	if (error) throw error;
}

export async function isEmailAllowed(email: string): Promise<boolean> {
	const { data, error } = await supabase
		.from('allowed_users')
		.select('email')
		.eq('email', email.toLowerCase())
		.maybeSingle();
	if (error) {
		console.error('[Auth] Error checking allowed_users:', error);
		return false;
	}
	return !!data;
}
