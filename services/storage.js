import fs from 'fs-extra';

const FILE = './scraper/seen.json';

export const getSeen = async () => {
  try {
    return await fs.readJson(FILE);
  } catch {
    return [];
  }
};

export const saveSeen = async (data) => {
  await fs.writeJson(FILE, data, { spaces: 2 });
};

