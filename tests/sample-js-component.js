import { useState, useEffect } from 'react';
import { fetchOrders } from './orderService';

export function OrderList({ companyId }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    fetchOrders(companyId).then(data => {
      setOrders(data);
      setLoading(false);
    });
  }, [companyId]);

  return (
    <div>
      <button onClick={() => setOrders([])}>Clear</button>
    </div>
  );
}
