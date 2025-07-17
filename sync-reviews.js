import axios from 'axios';
import fs from 'fs';
import slugify from 'slugify';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const WEBFLOW_COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;

const PLACE_ID = 'ChIJiSPKJ1bxCkcRz6wptMDp4Uo';
const CACHE_FILE = './review-cache.json';

// Validace environment variables
function validateEnvVars() {
  const required = ['GOOGLE_API_KEY', 'WEBFLOW_API_TOKEN', 'WEBFLOW_COLLECTION_ID'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error(`❌ Chybějící environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function fetchGoogleReviews() {
  try {
    console.log('🔍 Stahování recenzí z Google Places API...');
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&key=${GOOGLE_API_KEY}&language=cs&reviews_sort=newest`;
    
    const response = await axios.get(url);
    
    if (response.data.status !== 'OK') {
      throw new Error(`Google API error: ${response.data.status} - ${response.data.error_message || 'Unknown error'}`);
    }
    
    const place = response.data.result;
    
    if (!place) {
      throw new Error('Místo nebylo nalezeno');
    }
    
    return {
      placeUrl: place.url || '',
      reviews: place.reviews || []
    };
  } catch (error) {
    console.error('❌ Chyba při stahování Google recenzí:', error.message);
    throw error;
  }
}

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf8');
      return JSON.parse(data);
    }
    return { reviewIds: [] };
  } catch (error) {
    console.warn('⚠️ Nelze načíst cache, vytvářím nový:', error.message);
    return { reviewIds: [] };
  }
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    console.log('💾 Cache uložena');
  } catch (error) {
    console.error('❌ Chyba při ukládání cache:', error.message);
  }
}

function toSlug(name, id) {
  const cleanName = name.replace(/[^\w\s-]/g, '').trim();
  return slugify(`${cleanName}-${id}`, { lower: true, strict: true });
}

function buildItemPayload(review, placeUrl) {
  // Validace review dat
  if (!review.author_name || !review.rating || !review.time) {
    throw new Error('Neplatná data recenze');
  }

  // Sanitizace textu recenze
  const reviewText = review.text ? review.text.replace(/<[^>]*>/g, '') : '';
  
  return {
    isArchived: false,
    isDraft: false,
    fieldData: {
      name: review.author_name.substring(0, 100), // Omezení délky
      slug: toSlug(review.author_name, review.time),
      rating: Math.min(Math.max(review.rating, 1), 5), // Zajištění rozpětí 1-5
      text: reviewText ? `<p>${reviewText}</p>` : '<p>Bez komentáře</p>',
      date: new Date(review.time * 1000).toISOString(),
      source: 'Google',
      avatar: review.profile_photo_url || '',
      reviewUrl: placeUrl,
      reviewId: review.time.toString(),
    }
  };
}

async function sendToWebflow(item) {
  try {
    const url = `https://api.webflow.com/v2/collections/${WEBFLOW_COLLECTION_ID}/items?live=true`;
    
    const response = await axios.post(url, item, {
      headers: {
        Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      timeout: 30000 // 30 sekund timeout
    });
    
    console.log(`   ✅ Úspěšně nahráno - itemId: ${response.data.id}`);
    return response.data;
  } catch (error) {
    let errorMessage = 'Neznámá chyba';
    
    if (error.response) {
      // Server odpověděl s chybovým stavem
      errorMessage = `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`;
    } else if (error.request) {
      // Požadavek byl odeslán, ale nebyla obdržena odpověď
      errorMessage = 'Žádná odpověď od serveru';
    } else {
      // Chyba při vytváření požadavku
      errorMessage = error.message;
    }
    
    console.error(`   ❌ Webflow error: ${errorMessage}`);
    throw error;
  }
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  try {
    console.log('🚀 Spouštím synchronizaci recenzí...');
    
    // Validace
    validateEnvVars();
    
    // Stažení recenzí z Google
    const { placeUrl, reviews } = await fetchGoogleReviews();
    
    // Načtení cache
    const cache = loadCache();
    
    // Filtrování nových recenzí
    const newOnes = reviews.filter(r => !cache.reviewIds.includes(r.time.toString()));
    
    console.log(`\n📊 Statistiky:`);
    console.log(`   📈 Celkem recenzí z Google: ${reviews.length}`);
    console.log(`   🆕 Nových recenzí: ${newOnes.length}`);
    console.log(`   💾 V cache: ${cache.reviewIds.length}`);
    
    if (newOnes.length === 0) {
      console.log('✅ Žádné nové recenze k nahrání');
      return;
    }
    
    console.log(`\n🆕 Přehled nových recenzí:`);
    newOnes.forEach(r => {
      console.log(`   • ${r.author_name} (${r.rating}★) – ${new Date(r.time * 1000).toLocaleDateString('cs-CZ')}`);
    });
    
    // Nahrávání do Webflow
    console.log('\n📤 Nahráváním do Webflow...');
    const uploadedIds = [];
    
    for (const [index, review] of newOnes.entries()) {
      try {
        console.log(`📤 [${index + 1}/${newOnes.length}] Nahrávám: ${review.author_name}`);
        
        const item = buildItemPayload(review, placeUrl);
        await sendToWebflow(item);
        
        uploadedIds.push(review.time.toString());
        
        // Pauza mezi požadavky aby se předešlo rate limiting
        if (index < newOnes.length - 1) {
          await delay(1000);
        }
        
      } catch (error) {
        console.error(`❌ Chyba při nahrávání recenze ${review.author_name}:`, error.message);
        // Pokračujeme s dalšími recenzemi
      }
    }
    
    // Aktualizace cache pouze pro úspěšně nahrané recenze
    if (uploadedIds.length > 0) {
      cache.reviewIds.push(...uploadedIds);
      saveCache(cache);
      console.log(`✅ Úspěšně nahráno ${uploadedIds.length} nových recenzí`);
    }
    
    console.log('\n🎉 Synchronizace dokončena!');
    
  } catch (error) {
    console.error('❌ Kritická chyba:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Spuštění
main();