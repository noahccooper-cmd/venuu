import { useState, useEffect, useCallback } from 'react';
import { SignInWithApple } from '@capacitor-community/apple-sign-in';
import { supabase, envReady } from '../lib/supabase';
import type { Profile } from '../lib/types';
import type { CityKey } from '../lib/constants';
import type { User } from '@supabase/supabase-js';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsOnboard, setNeedsOnboard] = useState(false);

  useEffect(() => {
    if (!envReady) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setNeedsOnboard(false);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (authId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('auth_id', authId)
      .single();

    if (data) {
      setProfile(data);
      setNeedsOnboard(false);
    } else {
      setNeedsOnboard(true);
    }
    setLoading(false);
  };

  const signInWithApple = useCallback(async () => {
    if (!envReady) return { error: new Error('Supabase not configured') };

    try {
      const result = await SignInWithApple.authorize({
        clientId: 'com.venuu.app',
        redirectURI: '',
        scopes: 'email name',
      });

      const identityToken = result.response.identityToken;
      if (!identityToken) {
        return { error: new Error('No identity token received from Apple') };
      }

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: identityToken,
      });

      return { error };
    } catch (err) {
      return { error: err as Error };
    }
  }, []);

  const sendMagicLink = useCallback(async (email: string) => {
    if (!envReady) return { error: new Error('Supabase not configured') };
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    return { error };
  }, []);

  const createProfile = useCallback(async (
    username: string,
    classYear: number,
    city: CityKey,
  ) => {
    if (!user) return { error: new Error('Not authenticated') };

    const { data, error } = await supabase
      .from('profiles')
      .insert({
        auth_id: user.id,
        email: user.email!,
        username,
        display_name: username,
        class_year: classYear,
        city,
      })
      .select()
      .single();

    if (data) {
      setProfile(data);
      setNeedsOnboard(false);
    }
    return { error };
  }, [user]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setNeedsOnboard(false);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    await fetchProfile(user.id);
  }, [user]);

  return {
    user,
    profile,
    loading,
    needsOnboard,
    signInWithApple,
    sendMagicLink,
    createProfile,
    signOut,
    refreshProfile,
  };
}
