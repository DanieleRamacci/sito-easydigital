<?php
/**
 * Plugin Name: EDA Auth Bridge
 * Description: Bridge SSO tra WordPress e EDA Manager app + endpoint registrazione custom.
 * Version: 0.3.0
 * Author: Easy Digital Agency
 */

if (!defined('ABSPATH')) {
    exit;
}

final class EDA_Auth_Bridge {
    public static function init() {
        add_action('rest_api_init', [__CLASS__, 'register_routes']);
        add_action('login_enqueue_scripts', [__CLASS__, 'login_styles']);
        add_filter('login_headerurl',  [__CLASS__, 'login_logo_url']);
        add_filter('login_headertext', [__CLASS__, 'login_logo_text']);
        add_filter('login_headertitle', [__CLASS__, 'login_logo_text']); // WP < 5.2 compat
    }

    /* ------------------------------------------------------------------
     * WordPress login page customization
     * ------------------------------------------------------------------ */

    public static function login_styles() {
        ?>
        <style>
        /* ── Sfondo e layout ───────────────────────────────────────────── */
        body.login {
            background: #f5f8f6;
            font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
        }
        body.login #login {
            padding: 8vh 0 40px;
            width: 360px;
        }

        /* ── Logo / brand ───────────────────────────────────────────────── */
        body.login h1 a {
            background-image: none !important;
            background-size: 0 !important;
            width: auto !important;
            height: auto !important;
            text-indent: 0 !important;
            overflow: visible !important;
            display: block;
            text-align: center;
            font-size: 1.45rem;
            font-weight: 800;
            color: #14532d !important;
            letter-spacing: -.02em;
            line-height: 1.2;
            padding: 0 0 6px;
            text-shadow: none;
            box-shadow: none;
        }
        body.login h1 a::before {
            content: "Easy Digital";
            display: block;
            font-size: 1.45rem;
            font-weight: 800;
            color: #14532d;
        }
        body.login h1 a::after {
            content: "Agency";
            display: block;
            font-size: .95rem;
            font-weight: 500;
            color: #1f8a4c;
            letter-spacing: .04em;
            text-transform: uppercase;
        }

        /* ── Card ───────────────────────────────────────────────────────── */
        body.login #loginform,
        body.login #lostpasswordform,
        body.login #resetpassform {
            background: #fff;
            border: 1px solid #dce6df;
            border-radius: 14px;
            box-shadow: 0 4px 24px rgba(0,0,0,.06);
            padding: 28px 28px 22px;
            margin-top: 16px;
        }

        /* ── Campi input ────────────────────────────────────────────────── */
        body.login input[type="text"],
        body.login input[type="password"],
        body.login input[type="email"] {
            border: 1px solid #dce6df;
            border-radius: 8px;
            box-shadow: none;
            font-size: .95rem;
            padding: 9px 12px;
            transition: border-color .15s;
        }
        body.login input[type="text"]:focus,
        body.login input[type="password"]:focus,
        body.login input[type="email"]:focus {
            border-color: #1f8a4c;
            box-shadow: 0 0 0 2px rgba(31,138,76,.15);
            outline: none;
        }

        /* ── Pulsante submit ────────────────────────────────────────────── */
        body.login .button-primary,
        body.login input[type="submit"] {
            background: #1f8a4c !important;
            border: none !important;
            border-radius: 8px !important;
            box-shadow: none !important;
            color: #fff !important;
            font-size: .95rem !important;
            font-weight: 600 !important;
            letter-spacing: .01em;
            padding: 10px 0 !important;
            text-shadow: none !important;
            transition: background .15s !important;
            width: 100%;
        }
        body.login .button-primary:hover,
        body.login input[type="submit"]:hover {
            background: #14532d !important;
        }

        /* ── Messaggi errore / successo ─────────────────────────────────── */
        body.login .message,
        body.login .success {
            border-left: 4px solid #1f8a4c;
            border-radius: 6px;
            background: #f0fdf4;
            color: #14532d;
        }
        body.login .error,
        body.login #login_error {
            border-left: 4px solid #dc2626;
            border-radius: 6px;
            background: #fef2f2;
            color: #991b1b;
            box-shadow: none;
        }

        /* ── Link in basso ──────────────────────────────────────────────── */
        body.login #nav,
        body.login #backtoblog {
            text-align: center;
        }
        body.login #nav a,
        body.login #backtoblog a {
            color: #6b7280 !important;
            font-size: .82rem;
        }
        body.login #nav a:hover,
        body.login #backtoblog a:hover {
            color: #1f8a4c !important;
        }
        /* Nascondi "← Torna a [sito]" — l'utente non deve vedere il nome WP */
        body.login #backtoblog {
            display: none;
        }

        /* ── Labels ─────────────────────────────────────────────────────── */
        body.login label {
            color: #374151;
            font-size: .88rem;
            font-weight: 500;
        }

        /* ── Privacy policy notice ──────────────────────────────────────── */
        body.login .privacy-policy-page-link {
            display: none;
        }
        </style>
        <?php
    }

    public static function login_logo_url() {
        return home_url('/');
    }

    public static function login_logo_text() {
        return 'Easy Digital Agency';
    }

    public static function register_routes() {
        register_rest_route('eda-auth/v1', '/sso-start', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [__CLASS__, 'sso_start'],
            'permission_callback' => '__return_true',
        ]);

        register_rest_route('eda-auth/v1', '/register', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [__CLASS__, 'register_user'],
            'permission_callback' => '__return_true',
            'args' => [
                'username' => ['required' => true],
                'email' => ['required' => true],
                'password' => ['required' => true],
                'display_name' => ['required' => false],
            ],
        ]);
    }

    public static function sso_start(WP_REST_Request $request) {
        $next = $request->get_param('next');
        $next = is_string($next) ? $next : '/areapersonale';
        if (!preg_match('#^/(gestionale|areapersonale)(/.*)?$#', $next)) {
            $next = '/areapersonale';
        }
        $target_mode = $request->get_param('target');
        $target_mode = is_string($target_mode) ? strtolower(trim($target_mode)) : '';

        $user_id = self::resolve_logged_user_id();
        if (!$user_id) {
            $redirect = home_url('/wp-json/eda-auth/v1/sso-start?next=' . rawurlencode($next));
            wp_safe_redirect(wp_login_url($redirect));
            exit;
        }

        wp_set_current_user($user_id);
        $user = wp_get_current_user();
        if (!$user || !$user->ID) {
            return new WP_REST_Response(['message' => 'Utente non valido'], 401);
        }

        $secret = self::get_secret();
        if (!$secret) {
            return new WP_REST_Response(['message' => 'EDA_SSO_SECRET non configurato'], 500);
        }

        $payload = [
            'sub' => (int) $user->ID,
            'email' => $user->user_email,
            'display_name' => $user->display_name,
            'roles' => array_values((array) $user->roles),
            'iat' => time(),
            'exp' => time() + HOUR_IN_SECONDS,
        ];

        $token = self::jwt_encode($payload, $secret);

        $target = self::build_callback_target($token, $next, $target_mode);
        if ($target === '') {
            return new WP_REST_Response(['message' => 'Callback SSO non configurata'], 500);
        }

        // Callback URL puo essere su dominio esterno (es. backend staging).
        wp_redirect($target);
        exit;
    }

    public static function register_user(WP_REST_Request $request) {
        $username = sanitize_user((string) $request->get_param('username'), true);
        $email = sanitize_email((string) $request->get_param('email'));
        $password = (string) $request->get_param('password');
        $display_name = sanitize_text_field((string) $request->get_param('display_name'));

        if ($username === '' || $email === '' || $password === '') {
            return new WP_REST_Response(['message' => 'Campi obbligatori mancanti'], 400);
        }

        if (username_exists($username)) {
            return new WP_REST_Response(['message' => 'Username gia esistente'], 409);
        }

        if (email_exists($email)) {
            return new WP_REST_Response(['message' => 'Email gia registrata'], 409);
        }

        $user_id = wp_create_user($username, $password, $email);
        if (is_wp_error($user_id)) {
            return new WP_REST_Response(['message' => $user_id->get_error_message()], 400);
        }

        $update = [
            'ID' => $user_id,
            'role' => 'subscriber',
        ];
        if ($display_name !== '') {
            $update['display_name'] = $display_name;
            $update['nickname'] = $display_name;
            $update['first_name'] = $display_name;
        }
        wp_update_user($update);

        return new WP_REST_Response([
            'ok' => true,
            'user_id' => $user_id,
            'message' => 'Registrazione completata. Ora effettua il login.',
        ], 201);
    }

    private static function get_secret() {
        if (defined('EDA_SSO_SECRET') && EDA_SSO_SECRET) {
            return (string) EDA_SSO_SECRET;
        }
        $opt = get_option('eda_sso_secret', '');
        return is_string($opt) ? $opt : '';
    }

    private static function get_auth_callback_url() {
        if (defined('EDA_AUTH_CALLBACK_URL') && EDA_AUTH_CALLBACK_URL) {
            return trim((string) EDA_AUTH_CALLBACK_URL);
        }

        $opt = get_option('eda_auth_callback_url', '');
        return is_string($opt) ? trim($opt) : '';
    }

    private static function build_callback_target(string $token, string $next, string $target_mode) {
        // Modalita esplicita "v2": callback verso nuovo backend (NestJS).
        if ($target_mode === 'v2') {
            $callback_url = self::get_auth_callback_url();
            if ($callback_url === '') {
                return '';
            }

            $target = add_query_arg([
                'token' => $token,
                'next' => $next,
            ], $callback_url);
            return is_string($target) ? $target : '';
        }

        // Default: fallback legacy compatibile con manager-app.
        $legacy_callback = str_starts_with($next, '/gestionale') ? '/gestionale/auth/callback' : '/areapersonale/auth/callback';
        return home_url($legacy_callback . '?token=' . rawurlencode($token) . '&next=' . rawurlencode($next));
    }

    private static function resolve_logged_user_id() {
        if (is_user_logged_in()) {
            return get_current_user_id();
        }

        if (!defined('LOGGED_IN_COOKIE') || empty($_COOKIE[LOGGED_IN_COOKIE])) {
            return 0;
        }

        $cookie = wp_unslash((string) $_COOKIE[LOGGED_IN_COOKIE]);
        $uid = wp_validate_auth_cookie($cookie, 'logged_in');
        return $uid ? (int) $uid : 0;
    }

    private static function jwt_encode(array $payload, string $secret) {
        $header = ['alg' => 'HS256', 'typ' => 'JWT'];
        $segments = [];
        $segments[] = self::base64url_encode(wp_json_encode($header));
        $segments[] = self::base64url_encode(wp_json_encode($payload));

        $signing_input = implode('.', $segments);
        $signature = hash_hmac('sha256', $signing_input, $secret, true);
        $segments[] = self::base64url_encode($signature);

        return implode('.', $segments);
    }

    private static function base64url_encode($data) {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}

EDA_Auth_Bridge::init();
