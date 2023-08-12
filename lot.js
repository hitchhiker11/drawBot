const { Telegraf, Markup, Scenes, Stage, session } = require("telegraf");
const { Pool } = require("pg");
const moment = require("moment");
const cron = require("node-cron");
const { stepHandler } = require("./createScene"); // Импорт сцен из отдельного файла
// const { updateHandler } = require("./updateScene"); // Импорт сцен из отдельного файла
const { updateHandler } = require("./updateScene"); // замените 'path_to_scene_file' на реальный путь к вашему файлу сцены

const bot = new Telegraf("6135351544:AAFe0e-Nxs0XUC5K4e8bN1TfSFBA--CkvoQ");
const pool = new Pool({
  connectionString: "postgresql://gen_user:i87a1r25j3@176.57.218.95/default_db",
});
const adminId = 5219343362;

cron.schedule("0 0 * * *", async () => {
  const activeDraws = await getActiveDraws(); // Функция, которая возвращает все активные розыгрыши

  for (let draw of activeDraws) {
    if (draw.end_date && moment().isAfter(draw.end_date)) {
      await setDrawInactive(draw.id);
    }
  }
});

async function getReferralRewardTicketsForActiveDraw(drawId) {
  const queryResult = await pool.query(
    `SELECT referral_reward FROM sonam_draws WHERE draw_id = $1`,
    [drawId]
  );
  return queryResult.rows[0]?.referral_reward_tickets || 0; // Эта строка вернет количество билетов или 0, если результата нет
}

async function getDrawParticipantsCount(drawId) {
  const { rows } = await pool.query(
    "SELECT COUNT(*) as count FROM sonam_user_draws WHERE draw_id = $1",
    [drawId]
  );
  return parseInt(rows[0].count, 10);
}

async function setDrawInactive(drawId) {
  await pool.query("UPDATE sonam_draws SET active = false WHERE draw_id = $1", [
    drawId,
  ]);
}

async function updateDrawsStatusBasedOnEndDate() {
  await pool.query(
    "UPDATE sonam_draws SET is_active = false WHERE end_date < NOW() AND is_active = true"
  );
}

async function handleReferralActivation(ctx, userId) {
  const referralId = ctx.startPayload;

  if (referralId) {
    const referral = await getReferral(referralId);

    if (referral && referral.owner_id !== userId) {
      const channels = await getChannels(1); // Помните, что здесь может потребоваться использовать другой ID розыгрыша, в зависимости от вашей логики.
      const subscriptionCount = await getSubscriptionCount(
        bot.telegram,
        userId,
        channels
      );

      if (subscriptionCount === channels.length) {
        await updateTickets(referral.owner_id, 3, 1);
        bot.telegram
          .sendMessage(
            referral.owner_id,
            `Пользователь ${ctx.from.first_name} зарегистрировался по вашей реферальной ссылке и подписался на все каналы! Вы получили 3 дополнительных билета.`
          )
          .catch((error) => {
            console.log("Error sending message:", error);
          });
      }
    }
  }
}

async function getAllDraws() {
  const result = await pool.query("SELECT draw_id, draw_name FROM sonam_draws");
  return result.rows.map((row) => ({
    id: row.draw_id,
    name: row.draw_name,
  }));
}

async function getActiveDraws() {
  const result = await pool.query(
    "SELECT draw_id, draw_name FROM sonam_draws WHERE is_active = TRUE"
  );
  return result.rows.map((row) => ({
    id: row.draw_id,
    name: row.draw_name,
  }));
}

async function ensureUserExists(userId) {
  const userEntry = await pool.query(
    "SELECT * FROM sonam_users WHERE user_id = $1",
    [userId]
  );

  if (!userEntry.rows.length) {
    // Если записи нет, вставляем новую
    await pool.query(
      "INSERT INTO sonam_users (user_id, tickets) VALUES ($1, 0) ON CONFLICT DO NOTHING",
      [userId]
    );
  }
}

async function saveUserDrawChoice(userId, drawId) {
  // Убедимся, что пользователь существует в таблице sonam_users
  await ensureUserExists(userId);

  // Проверяем, существует ли запись для данного пользователя в sonam_user_draws
  const existingEntry = await pool.query(
    "SELECT * FROM sonam_user_draws WHERE user_id = $1",
    [userId]
  );

  if (existingEntry.rows.length) {
    // Если запись существует, обновляем её
    await pool.query(
      "UPDATE sonam_user_draws SET draw_id = $2 WHERE user_id = $1",
      [userId, drawId]
    );
  } else {
    // Если записи нет, вставляем новую
    await pool.query(
      "INSERT INTO sonam_user_draws (user_id, draw_id) VALUES ($1, $2)",
      [userId, drawId]
    );
  }
}

/* Get user tickets from DB */

async function getSubscriptionCount(telegram, userId, channels) {
  let count = 0;

  for (let channel of channels) {
    const member = await telegram.getChatMember(`@${channel}`, userId);
    if (member.status !== "left" && member.status !== "kicked") {
      count++;
    }
  }
  return count;
}

async function getReferralCount(referralId) {
  const result = await pool.query(
    "SELECT COUNT(*) as count FROM sonam_referrals WHERE referral_id = $1",
    [referralId]
  );
  return result.rows[0] ? result.rows[0].count : 0;
}

async function getRemainingTickets(drawId) {
  const draw = await getDraw(drawId);
  if (!draw) {
    // throw an error or handle this case
    console.log(`No draw found for drawId: ${drawId}`);
    return null;
  }
  const usersInDraw = await pool.query(
    "SELECT COUNT(*) FROM sonam_user_draws WHERE draw_id = $1",
    [drawId]
  );
  return draw.tickets - (usersInDraw.rows[0] ? usersInDraw.rows[0].count : 0);
}

async function getTickets(userId) {
  const result = await pool.query(
    "SELECT tickets FROM sonam_users WHERE user_id = $1",
    [userId]
  );
  return result.rows[0] ? result.rows[0].tickets : null;
}

async function updateTickets(userId, count, drawId) {
  // Обновляем количество билетов у пользователя
  await pool.query(
    "UPDATE sonam_users SET tickets = tickets + $1 WHERE user_id = $2",
    [count, userId]
  );

  // Уменьшаем общее количество билетов в розыгрыше
  await pool.query(
    "UPDATE sonam_draws SET tickets = tickets - $1 WHERE draw_id = $2",
    [count, drawId]
  );
}

async function getReferral(referralId) {
  const result = await pool.query(
    "SELECT * FROM sonam_referrals WHERE owner_id = $1",
    [referralId]
  );
  return result.rows[0];
}
async function getReferralByUserId(userId) {
  const result = await pool.query(
    "SELECT * FROM sonam_referrals WHERE user_id = $1",
    [userId]
  );
  return result.rows[0];
}

// Этот код вызывается, когда новый пользователь регистрируется по реферальной ссылке
async function registerUserViaReferralLink(ownerId, newUserId) {
  if (ownerId == null || newUserId == null) {
    console.error("OwnerID or NewUserId is null");
    return;
  }

  await pool.query(
    "INSERT INTO sonam_referrals (owner_id, user_id, referral_id) VALUES ($1, $2, $3) ON CONFLICT (referral_id) DO NOTHING",
    [ownerId, newUserId, newUserId]
  );
  console.log(
    `Registered new user via referral link. ownerId: ${ownerId}, newUserId: ${newUserId}`
  );
}

// async function createReferral(ownerId, userId) {
//   if (ownerId == null || userId == null) {
//     console.error("OwnerID or UserId is null");
//     return;
//   }

//   await pool.query(
//     "INSERT INTO sonam_referrals (owner_id, user_id, referral_id) VALUES ($1, $2, $3) ON CONFLICT (referral_id) DO NOTHING",
//     [ownerId, userId, userId]
//   );
//   console.log(
//     `Creating referral for ownerId: ${ownerId} and userId: ${userId}`
//   );

//   return `https://t.me/sonam_giveaway_bot?start=${userId}`;
// }

async function handleReferralLink(ownerId, newUserId) {
  if (ownerId == null || newUserId == null) {
    console.error("OwnerID or NewUserId is null");
    return;
  }

  await pool.query(
    "INSERT INTO sonam_referrals (owner_id, user_id, referral_id) VALUES ($1, $2, $3) ON CONFLICT (referral_id) DO NOTHING",
    [ownerId, newUserId, newUserId]
  );
  console.log(
    `Registered new user via referral link. ownerId: ${ownerId}, newUserId: ${newUserId}`
  );
}

async function createReferral(ownerId) {
  if (ownerId == null) {
    console.error("OwnerId is null");
    return;
  }

  return `https://t.me/sonam_giveaway_bot?start=${ownerId}`;
}
async function registerReferral(userId, ownerId) {
  await pool.query(
    "INSERT INTO sonam_referrals (user_id, owner_id) VALUES ($1, $2)",
    [userId, ownerId]
  );
}

async function getDraw(drawId) {
  const result = await pool.query(
    "SELECT * FROM sonam_draws WHERE draw_id = $1",
    [drawId]
  );
  return result.rows[0];
}

async function createDraw(adminId, drawName, channels, tickets, endDate) {
  await pool.query(
    "INSERT INTO sonam_draws (admin_id, draw_name, channels, tickets, end_date) VALUES ($1, $2, $3, $4, $5)",
    [adminId, drawName, channels, tickets, endDate]
  );
}

async function updateDraw(drawId, drawName, channels, tickets, endDate) {
  await pool.query(
    "UPDATE sonam_draws SET draw_name = $2, channels = $3, tickets = $4, end_date = $5 WHERE draw_id = $1",
    [drawId, drawName, channels, tickets, endDate]
  );
}

async function getOrCreateUser(userId) {
  const result = await pool.query(
    "SELECT * FROM sonam_users WHERE user_id = $1",
    [userId]
  );
  if (result.rows[0]) {
    return result.rows[0];
  } else {
    await pool.query(
      "INSERT INTO sonam_users (user_id, tickets) VALUES ($1, $2)",
      [userId, 0]
    );
    return { user_id: userId, tickets: 0 };
  }
}

async function getUserDraws(userId) {
  const result = await pool.query(
    "SELECT d.* FROM sonam_draws d JOIN sonam_user_draws ud ON d.draw_id = ud.draw_id WHERE ud.user_id = $1",
    [userId]
  );
  return result.rows;
}

async function getUserState(userId) {
  const result = await pool.query(
    "SELECT * FROM sonam_user_states WHERE user_id = $1",
    [userId]
  );
  return result.rows[0] ? result.rows[0].state : null;
}

async function setUserState(userId, state) {
  await pool.query(
    "INSERT INTO sonam_user_states (user_id, state) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET state = $2",
    [userId, state]
  );
}

async function getChannels(drawId) {
  const result = await pool.query(
    "SELECT channels FROM sonam_draws WHERE draw_id = $1",
    [drawId]
  );
  return result.rows[0] ? result.rows[0].channels : [];
}

const stage = new Scenes.Stage([updateHandler, stepHandler]);
bot.use(session());
bot.use(stage.middleware());

bot.start(async (ctx) => {
  await updateDrawsStatusBasedOnEndDate();
  // const draws = await getAllDraws();
  const draws = await getActiveDraws();
  for (let draw of draws) {
    const currentParticipants = await getDrawParticipantsCount(draw.id);

    if (
      (draw.end_date && moment().isAfter(draw.end_date)) ||
      (draw.endCount && currentParticipants >= draw.endCount)
    ) {
      await setDrawInactive(draw.id);
    }
  }
  const updatedDraws = await getActiveDraws();
  if (updatedDraws.length > 0 && ctx.from.id != adminId) {
    const buttons = updatedDraws.map((draw) =>
      Markup.button.callback(draw.name, `draw_${draw.id}`)
    );
    const keyboard = Markup.inlineKeyboard(buttons);
    ctx.reply("Выберите розыгрыш:", keyboard);
  } else {
    const referralId = ctx.startPayload;
    const userId = ctx.from.id;

    console.log("Start payload:", referralId);

    await getOrCreateUser(userId);

    if (referralId && referralId !== userId) {
      await handleReferralLink(referralId, userId);
    }

    if (referralId) {
      const existingReferralForUser = await getReferralByUserId(ctx.from.id);
      console.log(
        "refffffffffffffffffffffffffffffffffffffffffffffffffffffffff " +
          existingReferralForUser
      );
      if (existingReferralForUser) {
        await ctx.reply("Вы уже активировали реферальную ссылку ранее.");
        return;
      }

      const referral = await getReferral(referralId);
      console.log("Referral:", referral);

      if (referral && referral.owner_id !== userId) {
        const channels = await getChannels(draws[0].id);
        const subscriptionCount = await getSubscriptionCount(
          bot.telegram,
          userId,
          channels
        );

        if (subscriptionCount === channels.length) {
          const referralRewardTickets =
            await getReferralRewardTicketsForActiveDraw(draws[0].id);
          await updateTickets(
            referral.owner_id,
            referralRewardTickets,
            draws[0].id
          );

          bot.telegram
            .sendMessage(
              referral.owner_id,
              `Пользователь ${ctx.from.first_name} зарегистрировался по вашей реферальной ссылке и подписался на все каналы! Вы получили 3 дополнительных билета.`
            )
            .catch((error) => {
              console.log("Error sending message:", error);
            });
        }
      }
    }

    if (ctx.from.id == adminId) {
      return ctx.reply(
        "Выберите опцию:",
        Markup.inlineKeyboard([
          [
            Markup.button.callback("➕ Создать", "add_draw"),
            // Markup.button.callback("🗑 Удалить", "delete_draw"),
          ],
          [
            Markup.button.callback("📝 Изменить", "update_draw"),
            // Markup.button.callback("📊 Статистика", "draw_stats"),
          ],
        ])
      );
    }

    const channels = await getChannels(draws[0].id);
    await ctx.reply(
      "Добро пожаловать! Для участия в розыгрыше необходимо подписаться на следующие каналы:"
    );

    for (let chan of channels) {
      await ctx.reply(`https://t.me/${chan}`);
    }

    const subscriptionCount = await getSubscriptionCount(
      bot.telegram,
      ctx.from.id,
      channels
    );
    const tickets = await getTickets(ctx.from.id);
    const referralCount = await getReferralCount(ctx.from.id);
    const remainingTickets = await getRemainingTickets(draws[0].id);

    const emoji = subscriptionCount === channels.length ? "✅" : "❌";

    ctx.replyWithHTML(
      `Вы подписаны на <b>${subscriptionCount}/${channels.length}</b> канала(-ов) ${emoji}\nНа вашем балансе: <b>${tickets}</b> билет(-ов) 🏷️.\n<b>${referralCount}</b> человек(-а) перешло по вашей реферальной ссылке 🔗\nВсего в розыгрыше осталось: <b>${remainingTickets}</b> билетов`,
      Markup.inlineKeyboard([
        [Markup.button.callback("Обновить билеты", "check_tickets")],
        [
          Markup.button.callback("Получить реф. ссылку", "get_referral_link"),
          Markup.button.callback("Обновить", "refresh"),
        ],
      ])
    );
  }
});

bot.action("refresh", async (ctx) => {
  const referralId = ctx.startPayload;
  const userId = ctx.from.id;

  const draws = getActiveDraws();
  const user = await getOrCreateUser(userId);
  console.log("User:", user);
  if (referralId) {
    const referral = await getReferral(referralId);
    if (referral && referral.owner_id !== userId) {
      const channels = await getChannels(getUserDraws(ctx.from.id)[0].draw_id); // replace 1 with the actual draw id
      const subscriptionCount = await getSubscriptionCount(
        bot.telegram,
        userId,
        channels
      );

      if (subscriptionCount === channels.length) {
        const referralRewardTickets =
          await getReferralRewardTicketsForActiveDraw(draws[0].id);
        await updateTickets(
          referral.owner_id,
          referralRewardTickets,
          draws[0].id
        );

        bot.telegram.sendMessage(
          referral.owner_id,
          `Пользователь @${ctx.from.username} зарегистрировался по вашей реферальной ссылке и подписался на все каналы! Вы получили 3 дополнительных билета.`
        );
      }
    }
  }
  if (ctx.from.id == adminId) {
    // Предположим, что функция isAdmin проверяет, является ли пользователь админом
    // Отправка сообщения админу со специальными опциями
    return ctx.reply(
      "Выберите опцию:",
      Markup.inlineKeyboard([
        [
          Markup.button.callback("➕ Создать", "add_draw"),
          // Markup.button.callback("🗑 Удалить", "delete_draw"),
        ],
        [
          Markup.button.callback("📝 Изменить", "update_draw"),
          // Markup.button.callback("📊 Статистика", "draw_stats"),
        ],
      ])
    );
  }
  const userDraws = await getUserDraws(ctx.from.id);
  // console.log("////////////////////////////");

  // console.log(userDraws);

  const channels = await getChannels(userDraws[0].draw_id); // replace "draw_id" with the actual draw id
  const subscriptionCount = await getSubscriptionCount(
    bot.telegram,
    userId,
    channels
  );
  const tickets = await getTickets(userId);
  const referralCount = await getReferralCount(userId);
  const remainingTickets = await getRemainingTickets(userDraws[0].draw_id); // replace 1 with the actual draw id

  const emoji = subscriptionCount === channels.length ? "✅" : "❌";

  ctx.replyWithHTML(
    `Вы подписаны на <b>${subscriptionCount}/${channels.length}</b> канала(-ов) ${emoji}\nНа вашем балансе: <b>${tickets}</b> билет(-ов).\n<b>${referralCount}</b> человек(-а) перешло по вашей реферальной ссылке\nВсего в розыгрыше осталось: <b>${remainingTickets}</b> билетов`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback("Проверить подписки", "check_subscriptions"),
        Markup.button.callback("Обновить билеты", "check_tickets"),
      ],
      [
        Markup.button.callback(
          "Получить реферальную ссылку",
          "get_referral_link"
        ),
      ],
      [Markup.button.callback("Обновить всё", "refresh")],
    ])
  );
});

bot.action("check_subscriptions", async (ctx) => {
  const draws = await getUserDraws(ctx.from.id);
  // console.log(draws);
  let isSubscribed = true;

  for (let draw of draws) {
    const channels = await getChannels(draws[0].id);
    for (let channel of channels) {
      const member = await ctx.telegram.getChatMember(
        `@${channel}`,
        ctx.from.id
      );
      if (member.status === "left" || member.status === "kicked") {
        isSubscribed = false;
        break;
      }
    }
  }

  if (isSubscribed) {
    ctx.reply("Вы подписаны на все каналы ✅");
    await updateTickets(ctx.from.id, 1);
  } else {
    ctx.reply(
      "Вы подписаны не на все каналы. Пожалуйста, подпишитесь на оставшиеся каналы и повторите попытку."
    );
  }
});

bot.action("check_tickets", async (ctx) => {
  const tickets = await getTickets(ctx.from.id);
  ctx.reply(`You have ${tickets} tickets.`);
});

bot.action("get_referral_link", async (ctx) => {
  const link = await createReferral(ctx.from.id, ctx.from.id);
  ctx.reply(
    `Ваша реферальная ссылка: ${link}\n\nПри регистрации по ней на конкурс другим пользователем вы получите 3 билета на ваш баланс.`
  );
});

// bot.action("refresh", async (ctx) => {
//   /* Refresh user data */
// });

bot.action("add_draw", async (ctx) => {
  if (ctx.from.id !== adminId) return;
  ctx.scene.enter("stepHandler"); // Имя сцены должно совпадать с тем, что вы использовали при определении сцены
});

bot.command("newdraw", async (ctx) => {
  if (ctx.from.id !== adminId) return;
  ctx.scene.enter("stepHandler"); // Имя сцены должно совпадать с тем, что вы использовали при определении сцены
});

bot.command("updatedraw", async (ctx) => {
  /* Handle draw update process */
});

bot.action("update_draw", async (ctx) => {
  if (ctx.from.id !== adminId) return;

  const draws = await getAllDraws();
  const buttons = draws.flatMap((draw) => [
    Markup.button.callback(
      `🖊️ ${draw.name} ${draw.is_active ? "(X)" : ""} (id: ${draw.id})`,
      `admin_edit_draw_${draw.id}`
    ),
    Markup.button.callback(
      `🗑️ ${draw.name} (id: ${draw.id})`,
      `admin_delete_draw_${draw.id}`
    ),
  ]);

  ctx.reply(
    "Выберите розыгрыш для редактирования:",
    Markup.inlineKeyboard(buttons, { columns: 2 })
  );
});

bot.action(/^admin_edit_draw_(\d+)$/, async (ctx) => {
  const drawId = parseInt(ctx.match[1]);

  // Установите текущий статус розыгрыша в контексте сцены или базы данных
  ctx.scene.session.currentDrawId = drawId;

  // Переходите к сцене, где администратор может ввести новое название
  if (ctx.from.id !== adminId) return;
  ctx.scene.enter("update-handler");
});

bot.action(/^toggle_active_(\d+)$/, async (ctx) => {
  const drawId = parseInt(ctx.match[1]);
  await toggleDrawActive(drawId); // функция, которая переключает статус розыгрыша

  ctx.reply("Активность розыгрыша изменена.");
});

bot.action(/admin_delete_draw_(\d+)/, (ctx) => {
  const drawId = ctx.match[1];
  ctx.reply(
    `Вы уверены, что хотите удалить розыгрыш с ID ${drawId}?`,
    Markup.inlineKeyboard([
      Markup.button.callback("Да", `confirmDelete_${drawId}`),
      Markup.button.callback("Нет", `cancelDelete`),
    ])
  );
});

bot.action(/confirmDelete_(\d+)/, async (ctx) => {
  const drawId = ctx.match[1];
  await deleteDraw(drawId);
  ctx.reply(`Розыгрыш с ID ${drawId} был успешно удален.`);
});

bot.action("cancelDelete", (ctx) => {
  ctx.reply("Удаление отменено.");
});

bot.action(/draw_(\d+)/, async (ctx) => {
  const drawId = ctx.match[1];
  const userId = ctx.from.id;
  const draw = await getDraw(drawId);

  if (!draw || !draw.is_active) {
    await ctx.reply(
      "Извините, этот розыгрыш уже закончился или временно не доступен."
    );
    return;
  }

  // Сохраняем выбор пользователя в базе данных
  await saveUserDrawChoice(userId, drawId);

  // Отправляем подтверждение пользователю
  await ctx.reply(`Вы успешно выбрали розыгрыш с ID: ${drawId}.`);

  // Продолжаем диалог
  const channels = await getChannels(drawId);
  await ctx.reply(
    "Для участия в розыгрыше необходимо подписаться на следующие каналы:"
  );

  for (let chan of channels) {
    await ctx.reply(`https://t.me/${chan}`);
  }

  const subscriptionCount = await getSubscriptionCount(
    bot.telegram,
    userId,
    channels
  );
  const tickets = await getTickets(userId);
  const referralCount = await getReferralCount(userId);
  const remainingTickets = await getRemainingTickets(drawId);

  const emoji = subscriptionCount === channels.length ? "✅" : "❌";

  // Если пользователь подписался на все каналы, проверяем его реферальную историю
  if (subscriptionCount === channels.length) {
    const referral = await getReferralByUserId(userId);
    if (referral && referral.owner_id !== userId) {
      const referralRewardTickets = await getReferralRewardTicketsForActiveDraw(
        drawId
      );
      await updateTickets(referral.owner_id, referralRewardTickets, drawId);

      bot.telegram
        .sendMessage(
          referral.owner_id,
          `Пользователь @${ctx.from.first_name} зарегистрировался по вашей реферальной ссылке, выбрал розыгрыш и подписался на все каналы! Вы получили 3 дополнительных билета.`
        )
        .catch((error) => {
          console.log("Error sending message:", error);
        });
    }
  }

  ctx.replyWithHTML(
    `Вы подписаны на <b>${subscriptionCount}/${channels.length}</b> канала(-ов) ${emoji}\nНа вашем балансе: <b>${tickets}</b> билет(-ов) 🏷️.\n<b>${referralCount}</b> человек(-а) перешло по вашей реферальной ссылке 🔗\nВсего в розыгрыше осталось: <b>${remainingTickets}</b> билетов`,
    Markup.inlineKeyboard([
      [Markup.button.callback("Обновить билеты", "check_tickets")],
      [
        Markup.button.callback("Получить реф. ссылку", "get_referral_link"),
        Markup.button.callback("Обновить", "refresh"),
      ],
    ])
  );
});
bot.catch((err, ctx) => {
  console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
});

bot.launch();

process.on("SIGINT", () => {
  bot.stop("SIGINT");
});
