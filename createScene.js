const { Scenes, Markup } = require("telegraf");
const moment = require("moment");
const { Pool } = require("pg");
const cron = require("node-cron");

const pool = new Pool({
  connectionString: "postgresql://gen_user:i87a1r25j3@176.57.218.95/default_db",
});

async function createDraw(
  adminId,
  drawName,
  channels,
  tickets,
  endDate,
  maxParticipants,
  referralReward
) {
  await pool.query(
    "INSERT INTO sonam_draws (admin_id, draw_name, channels, tickets, end_date, max_participants, referral_reward) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      adminId,
      drawName,
      channels,
      tickets,
      endDate,
      maxParticipants,
      referralReward,
    ]
  );
}

const adminId = 5219343362;

const stepHandler = new Scenes.WizardScene(
  "stepHandler",
  (ctx) => {
    ctx.reply("Введите название розыгрыша:");
    return ctx.wizard.next();
  },
  (ctx) => {
    ctx.wizard.state.drawName = ctx.message.text;
    ctx.reply(
      "Введите юзернеймы каналов (разделять запятыми без пробелов: test1,test2,test3):"
    );
    return ctx.wizard.next();
  },
  (ctx) => {
    ctx.wizard.state.channels = ctx.message.text.split(",");
    ctx.reply("Введите число билетов:");
    return ctx.wizard.next();
  },
  (ctx) => {
    ctx.wizard.state.tickets = parseInt(ctx.message.text, 10);
    ctx.reply("Сколько билетов будет выдано за активацию реферальной ссылки?");
    return ctx.wizard.next();
  },
  (ctx) => {
    ctx.wizard.state.referralReward = parseInt(ctx.message.text, 10);
    ctx.reply(
      "Как будем заканчивать конкурс?:",
      Markup.inlineKeyboard([
        [Markup.button.callback("По дате", "end_by_date")],
        [Markup.button.callback("По числу участников", "end_by_count")],
      ])
    );
    return ctx.wizard.next();
  },
  (ctx) => {
    if (ctx.callbackQuery && ctx.callbackQuery.data === "end_by_date") {
      ctx.wizard.state.endType = "date";
      ctx.reply("Введите дату окончания розыгрыша (ГГГГ-ММ-ДД):");
    } else {
      ctx.wizard.state.endType = "count";
      ctx.reply("Введите число участников для завершения конкурса:");
    }
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (
      ctx.wizard.state.endType === "date" &&
      /^\d{4}-\d{2}-\d{2}$/.test(ctx.message.text)
    ) {
      ctx.wizard.state.endDate = moment(
        ctx.message.text,
        "YYYY-MM-DD"
      ).toDate();
    } else if (
      ctx.wizard.state.endType === "count" &&
      /^\d+$/.test(ctx.message.text)
    ) {
      ctx.wizard.state.endCount = parseInt(ctx.message.text, 10);
    }

    await createDraw(
      adminId,
      ctx.wizard.state.drawName,
      ctx.wizard.state.channels,
      ctx.wizard.state.tickets,
      ctx.wizard.state.endDate || null,
      ctx.wizard.state.endCount || null,
      ctx.wizard.state.referralReward
    );

    ctx.reply("Розыгрыш создан!");
    return ctx.scene.leave();
  }
);

module.exports = {
  stepHandler,
};
