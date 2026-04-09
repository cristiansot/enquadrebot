import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import { KEYWORDS } from './keywords.js';
import { getSeen, saveSeen } from '../services/storage.js';
import { sendAlert } from '../services/mailer.js';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const runBot = async () => {
  console.log('🚀 Iniciando scraping...');
  console.log('📋 Keywords a buscar:', KEYWORDS.length, 'palabras clave');
  console.log('');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  // Cargar cookies
  let hasCookies = false;
  try {
    const cookiesFile = await fs.readFile('./scraper/cookies.json', 'utf-8');
    const cookies = JSON.parse(cookiesFile);
    await page.setCookie(...cookies);
    hasCookies = true;
    console.log('✅ Cookies cargadas - Cantidad:', cookies.length);
  } catch (error) {
    console.log('⚠️ No hay cookies guardadas');
  }

  if (hasCookies) {
    console.log('🔐 Probando sesión guardada...');
    try {
      await page.goto('https://www.linkedin.com/feed/', { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      await delay(3000);
      
      const currentUrl = page.url();
      if (currentUrl.includes('login')) {
        console.log('⚠️ Cookies expiradas, necesitas login manual');
        hasCookies = false;
      } else {
        console.log('✅ Sesión restaurada correctamente');
      }
    } catch (error) {
      console.log('⚠️ Error cargando feed');
      hasCookies = false;
    }
  }

  if (!hasCookies) {
    console.log('\n========================================');
    console.log('🔐 LOGIN MANUAL REQUERIDO');
    console.log('========================================');
    console.log('📌 INSTRUCCIONES:');
    console.log('1️⃣  Se abrió una ventana de Chrome');
    console.log('2️⃣  Inicia sesión en LinkedIn MANUALMENTE');
    console.log('3️⃣  Espera a que cargue COMPLETAMENTE tu feed');
    console.log('4️⃣  Vuelve acá y presiona ENTER');
    console.log('========================================\n');
    
    await page.goto('https://www.linkedin.com/login', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    console.log('⏳ Esperando tu login manual...');
    await new Promise(resolve => process.stdin.once('data', () => resolve()));
    
    const cookies = await page.cookies();
    await fs.mkdir('./scraper', { recursive: true });
    await fs.writeFile('./scraper/cookies.json', JSON.stringify(cookies, null, 2));
    console.log(`✅ ${cookies.length} cookies guardadas`);
    await delay(2000);
  }

  console.log('\n🔍 Navegando a búsqueda de posts...');
  
  const SEARCH_URL = 'https://www.linkedin.com/search/results/content/?keywords=programador&sortBy=DATE_POSTED';
  
  try {
    await page.goto(SEARCH_URL, { 
      waitUntil: 'domcontentloaded', 
      timeout: 45000 
    });
    await delay(5000);
    console.log('✅ Página de búsqueda cargada');
  } catch (error) {
    console.log('❌ Error cargando búsqueda:', error.message);
    await browser.close();
    return;
  }

  console.log('🖱️ Haciendo scroll INFINITO para cargar más posts...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  let previousHeight = 0;
  let scrollCount = 0;
  let postCount = 0;
  const MAX_SCROLLS = 100;        // Máximo de scrolls
  const TARGET_POSTS = 150;      // Meta de posts a recolectar
  let noNewContentCount = 0;
  
  while (scrollCount < MAX_SCROLLS && postCount < TARGET_POSTS && noNewContentCount < 5) {
    // Scroll hasta el fondo
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    scrollCount++;
    
    // Esperar a que cargue contenido
    await delay(3000);
    
    // Contar posts actuales
    postCount = await page.evaluate(() => {
      return document.querySelectorAll('[data-urn]').length;
    });
    
    console.log(`📜 Scroll ${scrollCount}: ${postCount} posts encontrados`);
    
    // Verificar si hay más contenido
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === previousHeight) {
      noNewContentCount++;
      console.log(`   ⚠️ Sin nuevo contenido (${noNewContentCount}/5)`);
    } else {
      noNewContentCount = 0;
      console.log(`   📏 Altura: ${Math.round(newHeight/1000)}k px`);
      previousHeight = newHeight;
    }
    
    // Pequeño scroll hacia arriba para activar más carga (truco)
    if (scrollCount % 10 === 0) {
      await page.evaluate(() => window.scrollBy(0, -500));
      await delay(1500);
      await page.evaluate(() => window.scrollBy(0, 500));
      await delay(1500);
      console.log(`   🔄 Truco anti-bloqueo aplicado`);
    }
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ SCROLL COMPLETADO: ${scrollCount} scrolls, ${postCount} posts totales`);

  console.log('📊 Extrayendo posts...');
  
  const posts = await page.evaluate(() => {
    const elements = document.querySelectorAll('[data-urn]');
    return Array.from(elements).map(el => {
      const id = el.getAttribute('data-urn');
      const text = el.innerText || '';
      const link = el.querySelector('a')?.href || '';
      const author = el.querySelector('.update-components-actor__name')?.innerText || 'Desconocido';
      
      return { id, text: text.substring(0, 1500), link, author };
    });
  });

  console.log(`📦 Total posts encontrados: ${posts.length}`);

  if (posts.length === 0) {
    console.log('⚠️ No se encontraron posts');
    await browser.close();
    return;
  }

  // Mostrar ejemplos
  console.log('\n📝 Ejemplo de los primeros posts:');
  posts.slice(0, 5).forEach((post, i) => {
    console.log(`\n📌 Post ${i + 1}:`);
    console.log(`   👤 Autor: ${post.author}`);
    console.log(`   📄 Texto: ${post.text.substring(0, 200)}...`);
  });

  // Filtrar por keywords
  const seen = await getSeen();
  console.log(`\n👀 Posts ya vistos: ${seen.length}`);
  
  const newPosts = posts.filter(p => 
    p.id && 
    !seen.includes(p.id) && 
    KEYWORDS.some(k => p.text.toLowerCase().includes(k.toLowerCase()))
  );

  console.log(`🧠 Posts nuevos con keywords: ${newPosts.length}`);

  if (newPosts.length > 0) {
    console.log('\n📧 Enviando alertas...');
    newPosts.forEach((post, i) => {
      console.log(`\n✅ Post ${i + 1}: ${post.author}`);
      console.log(`   📄 ${post.text.substring(0, 150)}...`);
    });
    
    await sendAlert(newPosts);
    const updatedSeen = [...seen, ...newPosts.map(p => p.id)];
    await saveSeen(updatedSeen);
    console.log('✅ Alertas enviadas');
  } else {
    console.log('\n😴 No hay posts nuevos que coincidan con las keywords');
  }

  console.log('\n✨ Proceso completado');
  await browser.close();
};

runBot().catch(console.error);