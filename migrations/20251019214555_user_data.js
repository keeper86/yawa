/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.createTable('user_data', function (table) {
        table.string('user_id').primary().notNullable().index();
        table.string('email').notNullable();
        table.string('display_name').nullable();
        table.binary('avatar').nullable().defaultTo(null);
        table.string('username').nullable();
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.dropTableIfExists('user_data');
};
