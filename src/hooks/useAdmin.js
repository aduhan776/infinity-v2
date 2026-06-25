import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const useAdmin = (session) => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAdminStatus = async () => {
      // 🔥 LOG 1: Dekhne ke liye ki session aaya ya nahi
      console.log("1. Hook ke andar session:", session);

      if (!session?.user) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      try {
        // 🔥 LOG 2: Check karne ke liye ki kis User ID ke liye query chal rahi hai
        console.log("2. Query chal rahi hai User ID ke liye:", session.user.id);

        const { data, error } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', session.user.id)
          .single();

        // 🔥 LOG 3: Database se asliyat mein kya aaya
        console.log("3. DB se aaya Data:", data, " | Error:", error);

        if (!error && data) {
          setIsAdmin(data.is_admin || false);
        }
      } catch (err) {
        console.error("Error checking admin status:", err);
      } finally {
        setLoading(false);
      }
    };

    checkAdminStatus();
  }, [session]);

  return { isAdmin, loading };
};

export default useAdmin;