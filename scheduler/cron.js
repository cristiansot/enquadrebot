import cron from 'node-cron';
import { runBot } from '../scraper/linkedinBot.js';

cron.schedule('0 */8 * * *', () => {
  runBot();
});

