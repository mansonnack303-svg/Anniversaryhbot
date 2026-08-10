import 'dotenv/config';
import { Telegraf } from 'telegraf';
import cron from 'node-cron';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbFile = path.join(__dirname, 'db.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { events: [] });

await db.read();
db.data ||= { events: [] };
await db.write();

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in environment variables.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ---------- Helpers ----------
function parseDate(str) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (isNaN(date.getTime())) return null;
  return { year: Number(y), month: Number(m), day: Number(d) };
}

function nextOccurrence(month, day) {
  const now = new Date();
  const year = now.getFullYear();
  let next = new Date(year, month - 1, day);
  if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    next = new Date(year + 1, month - 1, day);
  }
  return next;
}

function daysUntil(month, day) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = nextOccurrence(month, day);
  next.setHours(0, 0, 0, 0);
  return Math.round((next - today) / (1000 * 60 * 60 * 24));
}

// ---------- Commands ----------
bot.start((ctx) => {
  ctx.reply(
    `👋 Welcome to Anniversary Bot!\n\n` +
    `I'll help you remember birthdays and anniversaries.\n\n` +
    `Commands:\n` +
    `/add <name> <YYYY-MM-DD> — add an event\n` +
    `/list — show all saved events\n` +
    `/delete <name> — remove an event\n` +
    `/help — show this message`
  );
});

bot.help((ctx) => {
  ctx.reply(
    `Commands:\n` +
    `/add <name> <YYYY-MM-DD> — add an event\n` +
    `/list — show all saved events\n` +
    `/delete <name> — remove an event`
  );
});

bot.command('add', async (ctx) => {
  const chatId = ctx.chat.id;
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 2) {
    return ctx.reply('Usage: /add <name> <YYYY-MM-DD>\nExample: /add Johns_Birthday 2026-08-15');
  }
  const dateStr = args[args.length - 1];
  const name = args.slice(0, -1).join(' ');
  const parsed = parseDate(dateStr);
  if (!parsed) {
    return ctx.reply('❌ Invalid date format. Use YYYY-MM-DD, e.g. 2026-08-15');
  }

  await db.read();
  db.data.events.push({
    chatId,
    name,
    year: parsed.year,
    month: parsed.month,
    day: parsed.day,
  });
  await db.write();

  ctx.reply(`✅ Saved "${name}" on ${dateStr}. I'll remind you 1 day before and on the day.`);
});

bot.command('list', async (ctx) => {
  const chatId = ctx.chat.id;
  await db.read();
  const events = db.data.events.filter((e) => e.chatId === chatId);
  if (events.length === 0) {
    return ctx.reply('You have no saved events yet. Use /add to create one.');
  }
  const lines = events
    .sort((a, b) => daysUntil(a.month, a.day) - daysUntil(b.month, b.day))
    .map((e) => {
      const d = daysUntil(e.month, e.day);
      const dateStr = `${e.year}-${String(e.month).padStart(2, '0')}-${String(e.day).padStart(2, '0')}`;
      return `• ${e.name} — ${dateStr} (in ${d} day${d === 1 ? '' : 's'})`;
    });
  ctx.reply(`📅 Your events:\n\n${lines.join('\n')}`);
});

bot.command('delete', async (ctx) => {
  const chatId = ctx.chat.id;
  const name = ctx.message.text.split(' ').slice(1).join(' ');
  if (!name) {
    return ctx.reply('Usage: /delete <name>');
  }
  await db.read();
  const before = db.data.events.length;
  db.data.events = db.data.events.filter(
    (e) => !(e.chatId === chatId && e.name.toLowerCase() === name.toLowerCase())
  );
  await db.write();
  if (db.data.events.length < before) {
    ctx.reply(`🗑️ Deleted "${name}".`);
  } else {
    ctx.reply(`No event found named "${name}". Use /list to see saved events.`);
  }
});

// ---------- Daily reminder check (runs every day at 9:00 AM server time) ----------
cron.schedule('0 9 * * *', async () => {
  await db.read();

  for (const e of db.data.events) {
    const d = daysUntil(e.month, e.day);
    try {
      if (d === 1) {
        await bot.telegram.sendMessage(e.chatId, `🔔 Reminder: "${e.name}" is tomorrow!`);
      } else if (d === 0) {
        await bot.telegram.sendMessage(e.chatId, `🎉 Today is "${e.name}"! Don't forget to celebrate!`);
      }
    } catch (err) {
      console.error(`Failed to send reminder for ${e.name}:`, err.message);
    }
  }
});

bot.launch();
console.log('Anniversary bot is running...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
