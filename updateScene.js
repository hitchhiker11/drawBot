const { Scenes } = require("telegraf");
const moment = require("moment");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: "postgresql://gen_user:i87a1r25j3@176.57.218.95/default_db",
});

async function getDraw(drawId) {
  const result = await pool.query(
    "SELECT * FROM sonam_draws WHERE draw_id = $1",
    [drawId]
  );
  return result.rows[0];
}

async function updateDraw(
  drawId,
  drawName,
  channels,
  tickets,
  endDate,
  referralReward
) {
  await pool.query(
    "UPDATE sonam_draws SET draw_name = $2, channels = $3, tickets = $4, end_date = $5, referral_reward = $6 WHERE draw_id = $1",
    [drawId, drawName, channels, tickets, endDate, referralReward]
  );
}

const adminId = 5219343362;

const updateHandler = new Scenes.WizardScene(
  "update-handler",
  (ctx) => {
    ctx.reply("Enter draw id:");
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !ctx.message.text) {
      return ctx.reply("Please provide a valid draw ID.");
    }
    const drawId = ctx.message.text;
    const draw = await getDraw(drawId);
    if (!draw) {
      ctx.reply("No draw found for this id");
      return ctx.scene.leave();
    }

    ctx.wizard.state.drawId = drawId;
    ctx.reply("Enter new draw name:");
    return ctx.wizard.next();
  },
  (ctx) => {
    ctx.wizard.state.newDrawName = ctx.message.text;
    ctx.reply("Enter new channel usernames (comma separated):");
    return ctx.wizard.next();
  },
  (ctx) => {
    ctx.wizard.state.newChannels = ctx.message.text.split(",");
    ctx.reply("Enter new ticket count:");
    return ctx.wizard.next();
  },
  (ctx) => {
    ctx.wizard.state.newTickets = parseInt(ctx.message.text, 10);
    ctx.reply("Enter new referral reward ticket count:");
    return ctx.wizard.next();
  },

  (ctx) => {
    ctx.wizard.state.newReferralReward = parseInt(ctx.message.text, 10);
    ctx.reply("Enter new draw end date (YYYY-MM-DD):");
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!moment(ctx.message.text, "YYYY-MM-DD").isValid()) {
      ctx.reply("Invalid date format");
      return ctx.scene.leave();
    }
    ctx.wizard.state.newEndDate = moment(
      ctx.message.text,
      "YYYY-MM-DD"
    ).toDate();

    await updateDraw(
      ctx.wizard.state.drawId,
      ctx.wizard.state.newDrawName,
      ctx.wizard.state.newChannels,
      ctx.wizard.state.newTickets,
      ctx.wizard.state.newEndDate,
      ctx.wizard.state.newReferralReward
    );

    ctx.reply("Draw updated!");
    return ctx.scene.leave();
  }
);

module.exports = {
  updateHandler,
};
