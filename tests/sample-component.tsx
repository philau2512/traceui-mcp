/**
 * Sample React component for testing TraceUI parser
 * Tests: function component, arrow component, handlers, state, effects, API calls
 */

import { useState, useEffect, useCallback } from 'react';
import { fetch } from './api';

// Function component
export function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handler
  const handleRefresh = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/users/${userId}`);
      const data = await res.json();
      setUser(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  };

  // Handler with setState
  const handleClear = () => {
    setUser(null);
    setError(null);
  };

  // Effect
  useEffect(() => {
    handleRefresh();
  }, [userId]);

  return (
    <div>
      <button onClick={handleRefresh}>Refresh</button>
      <button onClick={handleClear}>Clear</button>
      {loading && <p>Loading...</p>}
      {error && <p>{error}</p>}
      {user && <p>{user.name}</p>}
    </div>
  );
}

// Arrow component
export const UserCard = ({ user }: { user: User }) => {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);

  const toggleExpand = () => setExpanded(!expanded);
  const toggleEdit = () => setEditing(!editing);

  const handleSave = () => {
    setEditing(false);
  };

  useEffect(() => {
    console.log('UserCard expanded:', expanded);
  }, [expanded]);

  return (
    <div>
      <button onClick={toggleExpand}>Expand</button>
      <button onClick={toggleEdit}>Edit</button>
      {editing && <button onClick={handleSave}>Save</button>}
    </div>
  );
};

// Type definitions
interface User {
  id: string;
  name: string;
  email: string;
}