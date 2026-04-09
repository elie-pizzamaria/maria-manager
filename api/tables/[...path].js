const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const parts = req.query.path || [];
  const table = parts[0];
  const id    = parts[1];

  if (!table) return res.status(400).json({ error: 'Table manquante' });

  try {
    if (req.method === 'GET') {
      let query = supabase.from(table).select('*');
      if (id) {
        query = query.eq('id', id);
        const { data, error } = await query.single();
        if (error) throw error;
        return res.status(200).json(data);
      }
      const { limit, sort, ...filters } = req.query;
      if (limit) query = query.limit(parseInt(limit));
      if (sort)  query = query.order(sort);
      Object.entries(filters).forEach(([k, v]) => {
        if (k !== 'path') query = query.eq(k, v);
      });
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ data });
    }

    if (req.method === 'POST') {
      const { data, error } = await supabase.from(table).insert(req.body).select().single();
      if (error) throw error;
      return res.status(201).json(data);
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      const { data, error } = await supabase.from(table).update(req.body).eq('id', id).select().single();
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
      return res.status(204).end();
    }

    return res.status(405).json({ error: 'Méthode non autorisée' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
