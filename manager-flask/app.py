from eda_manager import create_app

app = create_app()

if __name__ == "__main__":
    import os

    port = int(os.getenv("PORT", "5051"))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
