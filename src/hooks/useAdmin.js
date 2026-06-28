import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const useAdmin = (session) => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    
    const checkAdminStatus = async () => {
      if (!session?.user) {
        if (isMounted) {
          setIsAdmin(false);
          setLoading(false);
        }
        return;
      }

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', session.user.id)
          .single();

        if (isMounted && !error && data) {
          setIsAdmin(data.is_admin || false);
        }
      } catch (err) {
        console.error("Administrative authentication gateway boundary exception caught safely.");
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    checkAdminStatus();
    
    return () => {
      isMounted = false;
    };
  }, [session]);

  return { isAdmin, loading };
};

export default useAdmin;