import click
from flask import Flask

from .config import Config
from .extensions import db, migrate
from .models import DebtItem, Job
from .services.query import upsert_debt_from_job
from .views.web import bp as web_bp


def create_app(config_object=Config):
    app = Flask(
        __name__,
        template_folder="../templates",
        static_folder="../static",
        static_url_path="/static",
    )
    app.config.from_object(config_object)
    app.config["JSON_STORE_DIR"].mkdir(parents=True, exist_ok=True)

    db.init_app(app)
    migrate.init_app(app, db)

    app.register_blueprint(web_bp)

    @app.cli.command("init-db")
    def init_db_command():
        db.create_all()
        click.echo("Database inizializzato")

    @app.cli.command("sync-debts")
    def sync_debts_command():
        db.create_all()
        for job in Job.query.all():
            upsert_debt_from_job(job)
        db.session.commit()
        click.echo("Debiti riallineati da jobs")

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
