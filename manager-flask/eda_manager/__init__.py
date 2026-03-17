import click
from flask import Flask

from .config import Config
from .extensions import db, mail, migrate
from .models import AdminUser, DebtItem, Job
from .services.query import process_renewals, sync_all_debts_from_jobs, upsert_debt_from_job
from .views.web import bp as web_bp


def create_app(config_object=Config):
    app = Flask(
        __name__,
        template_folder="../templates",
        static_folder="../static",
        static_url_path="/gestionale/static",
    )
    app.config.from_object(config_object)
    app.config["JSON_STORE_DIR"].mkdir(parents=True, exist_ok=True)

    db.init_app(app)
    migrate.init_app(app, db)
    mail.init_app(app)

    app.register_blueprint(web_bp)

    # -----------------------------------------------------------------------
    # CLI Commands
    # -----------------------------------------------------------------------

    @app.cli.command("init-db")
    def init_db_command():
        """Create all tables (safe to run on existing DB — won't drop data)."""
        db.create_all()
        click.echo("Database inizializzato.")

    @app.cli.command("fix-schema")
    def fix_schema_command():
        """Apply schema fixes for existing databases (drop old unique index, create new)."""
        with db.engine.connect() as conn:
            # Drop the old ux_debt_source index if it exists (replaced by ux_debt_job_source)
            try:
                conn.execute(db.text("DROP INDEX IF EXISTS ux_debt_source"))
                conn.commit()
                click.echo("Indice ux_debt_source rimosso.")
            except Exception as e:
                click.echo(f"Nota: {e}")

            # Add new columns to existing tables if missing
            migrations = [
                "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_status VARCHAR DEFAULT 'pending'",
                "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description TEXT",
                "ALTER TABLE customers ADD COLUMN IF NOT EXISTS fic_entity_id BIGINT",
            ]
            for sql in migrations:
                try:
                    conn.execute(db.text(sql))
                    conn.commit()
                except Exception as e:
                    click.echo(f"Migrazione saltata ({e})")

            # Create new tables if they don't exist
            db.create_all()
            click.echo("Schema aggiornato.")

    @app.cli.command("sync-debts")
    def sync_debts_command():
        """Re-sync all Job amounts to their DebtItems."""
        db.create_all()
        sync_all_debts_from_jobs()
        click.echo("Debiti riallineati da jobs.")

    @app.cli.command("process-renewals")
    def process_renewals_command():
        """Generate DebtItems and Notifications for subscription renewals due today or earlier."""
        db.create_all()
        created = process_renewals()
        if created:
            click.echo(f"Rinnovi processati: {', '.join(created)}")
        else:
            click.echo("Nessun rinnovo da processare.")

    @app.cli.command("create-admin")
    @click.argument("email")
    @click.argument("password")
    @click.option("--name", default="Admin", help="Nome visualizzato")
    def create_admin_command(email: str, password: str, name: str):
        """Create a local admin user. Usage: flask create-admin EMAIL PASSWORD"""
        from .auth import hash_password
        db.create_all()
        existing = AdminUser.query.filter(AdminUser.email == email.lower()).first()
        if existing:
            click.echo(f"Admin con email {email} già esistente.")
            return
        admin = AdminUser(
            email=email.lower().strip(),
            name=name,
            password_hash=hash_password(password),
        )
        db.session.add(admin)
        db.session.commit()
        click.echo(f"Admin creato: {email}")

    @app.cli.command("import-store")
    def import_store_command():
        from .importer import import_from_store_json

        db.create_all()
        store_file = app.config["JSON_STORE_FILE"]
        if not store_file.exists():
            click.echo(f"Store file non trovato: {store_file}")
            return
        result = import_from_store_json(store_file)
        click.echo(f"Import completato: {result}")

    return app
