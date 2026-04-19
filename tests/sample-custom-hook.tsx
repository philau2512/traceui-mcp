/**
 * Sample custom hook for testing
 */

import { useState, useEffect } from 'react';

// Custom hook: useAuth
export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch user on mount
    fetch('/api/me').then(setUser).finally(() => setLoading(false));
  }, []);

  return { user, loading, login: () => {}, logout: () => {} };
}

// Custom hook: useDataFetcher
export const useDataFetcher = (url: string) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(url).then(setData).finally(() => setLoading(false));
  }, [url]);

  return { data, loading };
};