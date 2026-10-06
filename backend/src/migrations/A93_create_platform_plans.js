/**
 * Catalogo de planos gerenciado pelo super admin e overrides de limite por conta.
 * Espelha prisma/schema.prisma (fonte do schema em producao) para o SQLite local.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('platform_plans'))) {
    await knex.schema.createTable('platform_plans', (table) => {
      table.increments('id').primary();
      table.string('slug', 80).notNullable().unique();
      table.string('name', 120).notNullable();
      table.text('description').nullable();
      table.integer('monthly_price_cents').notNullable().defaultTo(0);
      table.integer('emails_per_minute').notNullable();
      table.integer('emails_per_hour').notNullable();
      table.integer('emails_per_day').notNullable();
      table.integer('emails_per_month').notNullable();
      table.integer('domains_limit').notNullable();
      table.integer('webhooks_limit').notNullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.boolean('is_default').notNullable().defaultTo(false);
      table.integer('sort_order').notNullable().defaultTo(0);
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.index(['is_active', 'sort_order']);
    });
  }

  if (await knex.schema.hasTable('account_subscriptions')) {
    const columns = [
      'override_emails_per_minute',
      'override_emails_per_hour',
      'override_emails_per_day',
      'override_emails_per_month',
      'override_domains_limit',
      'override_webhooks_limit'
    ];
    for (const column of columns) {
      if (!(await knex.schema.hasColumn('account_subscriptions', column))) {
        await knex.schema.alterTable('account_subscriptions', (table) => {
          table.integer(column).nullable();
        });
      }
    }
    if (!(await knex.schema.hasColumn('account_subscriptions', 'notes'))) {
      await knex.schema.alterTable('account_subscriptions', (table) => {
        table.text('notes').nullable();
      });
    }
  }

  await knex.schema.alterTable('emails', (table) => {
    table.index(['user_id', 'created_at'], 'emails_user_id_created_at_index');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('emails', (table) => {
    table.dropIndex(['user_id', 'created_at'], 'emails_user_id_created_at_index');
  });

  if (await knex.schema.hasTable('account_subscriptions')) {
    const columns = [
      'override_emails_per_minute',
      'override_emails_per_hour',
      'override_emails_per_day',
      'override_emails_per_month',
      'override_domains_limit',
      'override_webhooks_limit',
      'notes'
    ];
    for (const column of columns) {
      if (await knex.schema.hasColumn('account_subscriptions', column)) {
        await knex.schema.alterTable('account_subscriptions', (table) => {
          table.dropColumn(column);
        });
      }
    }
  }

  await knex.schema.dropTableIfExists('platform_plans');
};
