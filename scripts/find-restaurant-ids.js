#!/usr/bin/env node
/**
 * Script pour trouver les IDs Zelty de vos restaurants.
 * 
 * Usage :
 *   node scripts/find-restaurant-ids.js
 * 
 * Prérequis :
 *   Avoir défini ZELTY_API_KEY dans .env.local
 */

require('dotenv').config({ path: '.env.local' });

const ZELTY_API_KEY = process.env.ZELTY_API_KEY;
const ZELTY_BASE = 'https://api.zelty.fr/2.10';

if (!ZELTY_API_KEY) {
  console.error('❌ Erreur : ZELTY_API_KEY non défini dans .env.local');
  console.log('\n💡 Ajoutez dans .env.local :');
  console.log('   ZELTY_API_KEY=votre_cle_enseigne_ici\n');
  process.exit(1);
}

async function fetchRestaurants() {
  console.log('🔍 Récupération de la liste des restaurants Zelty...\n');

  try {
    const response = await fetch(`${ZELTY_BASE}/restaurants`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ZELTY_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        console.error('❌ Clé API invalide (HTTP 401/403)');
        console.log('Vérifiez la valeur de ZELTY_API_KEY dans .env.local\n');
        process.exit(1);
      }
      console.error(`❌ Erreur HTTP ${response.status}`);
      process.exit(1);
    }

    const data = await response.json();
    const list = Array.isArray(data)
      ? data
      : (data.restaurants ?? data.data ?? (data.id ? [data] : []));

    if (list.length === 0) {
      console.log('⚠️  Aucun restaurant trouvé avec cette clé API.');
      process.exit(0);
    }

    console.log(`✅ ${list.length} restaurant(s) trouvé(s) :\n`);
    console.log('─'.repeat(60));

    list.forEach((resto, index) => {
      const id = resto.id || '(pas d\'id)';
      const name = resto.name || resto.nom || '(sans nom)';
      const address = resto.address || resto.adresse || '';
      
      console.log(`\n${index + 1}. ${name}`);
      console.log(`   ID Zelty : ${id}`);
      if (address) console.log(`   Adresse  : ${address}`);
    });

    console.log('\n' + '─'.repeat(60));
    console.log('\n💡 Copiez les IDs dans .env.local :');
    console.log('\n   ZELTY_RESTAURANT_DAX=...');
    console.log('   ZELTY_RESTAURANT_MDM=...\n');

    console.log('📋 Ou directement dans Vercel → Settings → Environment Variables\n');

  } catch (error) {
    console.error('❌ Erreur réseau :', error.message);
    console.log('\nVérifiez votre connexion internet et que l\'URL Zelty est accessible.');
    process.exit(1);
  }
}

fetchRestaurants();
