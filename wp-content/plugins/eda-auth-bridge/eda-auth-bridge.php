<?php
/**
 * Plugin Name: EDA Auth Bridge
 * Description: Bridge SSO tra WordPress e EDA Manager app + endpoint registrazione custom.
 * Version: 0.1.0
 * Author: Easy Digital Agency
 */

if (!defined('ABSPATH')) {
    exit;
}

final class EDA_Auth_Bridge {
    public static function init() {
        add_action('rest_api_init', [__CLASS__, 'register_routes']);
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

        if (!is_user_logged_in()) {
            $redirect = home_url('/wp-json/eda-auth/v1/sso-start?next=' . rawurlencode($next));
            wp_safe_redirect(wp_login_url($redirect));
            exit;
        }

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

        $callback = str_starts_with($next, '/gestionale') ? '/gestionale/auth/callback' : '/areapersonale/auth/callback';
        $target = home_url($callback . '?token=' . rawurlencode($token) . '&next=' . rawurlencode($next));

        wp_safe_redirect($target);
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
