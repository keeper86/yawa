exports.up = async function (knex) {
    await knex.raw(`ALTER TABLE creation_jobs ADD COLUMN usage JSONB`);
};

exports.down = async function (knex) {
    await knex.raw(`ALTER TABLE creation_jobs DROP COLUMN usage`);
};
