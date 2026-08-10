import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/config.dart';
import '../../../core/theme.dart';
import '../domain/auth_state.dart';
import '../providers/auth_provider.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _apiKeyCtrl = TextEditingController();
  final _serverCtrl = TextEditingController(text: AppConfig.defaultBaseUrl);

  bool _showApiKeyMode = false;
  bool _showPassword = false;
  bool _showAdvanced = false;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    _apiKeyCtrl.dispose();
    _serverCtrl.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    if (!_formKey.currentState!.validate()) return;

    // Always save server URL (even if default) to override stale stored values
    final serverUrl = _serverCtrl.text.trim();
    if (serverUrl.isNotEmpty) {
      await ref.read(authStateProvider.notifier).setServerUrl(serverUrl);
    }

    bool success;
    if (_showApiKeyMode) {
      success = await ref
          .read(authStateProvider.notifier)
          .loginWithApiKey(_apiKeyCtrl.text.trim());
    } else {
      success = await ref
          .read(authStateProvider.notifier)
          .login(_emailCtrl.text.trim(), _passwordCtrl.text);
    }

    if (!success && mounted) {
      final authState = ref.read(authStateProvider).valueOrNull;
      final errorMsg = authState is AuthError ? authState.message : 'Login failed';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(errorMsg), backgroundColor: GodTheme.error),
      );
    }
  }

  Future<void> _handleGoogleLogin() async {
    // Always save server URL (even if default) to override stale stored values
    final serverUrl = _serverCtrl.text.trim();
    if (serverUrl.isNotEmpty) {
      await ref.read(authStateProvider.notifier).setServerUrl(serverUrl);
    }

    final success =
        await ref.read(authStateProvider.notifier).loginWithGoogle();

    if (!success && mounted) {
      final authState = ref.read(authStateProvider).valueOrNull;
      final errorMsg =
          authState is AuthError ? authState.message : 'Google login failed';
      // Don't show snackbar for cancellation
      if (authState is! Unauthenticated ||
          (authState as Unauthenticated).message != 'Sign-in cancelled') {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(errorMsg), backgroundColor: GodTheme.error),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authStateProvider);
    final isLoading = authState.valueOrNull?.isLoading ?? false;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Logo / Title
                    const Icon(
                      Icons.visibility,
                      size: 64,
                      color: GodTheme.primary,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'GOD Frame',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.displaySmall?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Brilliant Frame + GOD CRM',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: GodTheme.textSecondary,
                          ),
                    ),
                    const SizedBox(height: 48),

                    // Toggle between email/password and API key
                    Row(
                      children: [
                        Expanded(
                          child: _ModeTab(
                            label: 'Email',
                            isActive: !_showApiKeyMode,
                            onTap: () => setState(() => _showApiKeyMode = false),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _ModeTab(
                            label: 'API Key',
                            isActive: _showApiKeyMode,
                            onTap: () => setState(() => _showApiKeyMode = true),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),

                    if (!_showApiKeyMode) ...[
                      // Email field
                      TextFormField(
                        controller: _emailCtrl,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email],
                        decoration: const InputDecoration(
                          labelText: 'Email',
                          prefixIcon: Icon(Icons.email_outlined),
                        ),
                        validator: (v) {
                          if (v == null || v.trim().isEmpty) return 'Enter your email';
                          if (!v.contains('@')) return 'Invalid email';
                          return null;
                        },
                      ),
                      const SizedBox(height: 16),

                      // Password field
                      TextFormField(
                        controller: _passwordCtrl,
                        obscureText: !_showPassword,
                        autofillHints: const [AutofillHints.password],
                        decoration: InputDecoration(
                          labelText: 'Password',
                          prefixIcon: const Icon(Icons.lock_outline),
                          suffixIcon: IconButton(
                            icon: Icon(
                              _showPassword ? Icons.visibility_off : Icons.visibility,
                            ),
                            onPressed: () =>
                                setState(() => _showPassword = !_showPassword),
                          ),
                        ),
                        validator: (v) {
                          if (v == null || v.isEmpty) return 'Enter your password';
                          return null;
                        },
                      ),
                    ] else ...[
                      // API Key field
                      TextFormField(
                        controller: _apiKeyCtrl,
                        decoration: const InputDecoration(
                          labelText: 'API Key',
                          hintText: 'sk-...',
                          prefixIcon: Icon(Icons.key),
                        ),
                        validator: (v) {
                          if (v == null || v.trim().isEmpty) return 'Enter your API key';
                          return null;
                        },
                      ),
                    ],

                    const SizedBox(height: 24),

                    // Login button
                    SizedBox(
                      height: 52,
                      child: ElevatedButton(
                        onPressed: isLoading ? null : _handleLogin,
                        child: isLoading
                            ? const SizedBox(
                                height: 24,
                                width: 24,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Text('Sign In'),
                      ),
                    ),

                    const SizedBox(height: 20),

                    // Divider with "or"
                    Row(
                      children: [
                        Expanded(
                          child: Divider(color: GodTheme.border, thickness: 1),
                        ),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: Text(
                            'or',
                            style: TextStyle(
                              color: GodTheme.textMuted,
                              fontSize: 14,
                            ),
                          ),
                        ),
                        Expanded(
                          child: Divider(color: GodTheme.border, thickness: 1),
                        ),
                      ],
                    ),

                    const SizedBox(height: 20),

                    // Google Sign-In button
                    SizedBox(
                      height: 52,
                      child: OutlinedButton.icon(
                        onPressed: isLoading ? null : _handleGoogleLogin,
                        icon: const Icon(Icons.g_mobiledata, size: 28),
                        label: const Text('Sign in with Google'),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: GodTheme.textPrimary,
                          side: BorderSide(color: GodTheme.border),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                      ),
                    ),

                    const SizedBox(height: 16),

                    // Advanced: server URL
                    TextButton(
                      onPressed: () =>
                          setState(() => _showAdvanced = !_showAdvanced),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            _showAdvanced
                                ? Icons.expand_less
                                : Icons.expand_more,
                            size: 18,
                            color: GodTheme.textMuted,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            'Server Settings',
                            style: TextStyle(color: GodTheme.textMuted),
                          ),
                        ],
                      ),
                    ),

                    if (_showAdvanced) ...[
                      const SizedBox(height: 8),
                      TextFormField(
                        controller: _serverCtrl,
                        keyboardType: TextInputType.url,
                        decoration: const InputDecoration(
                          labelText: 'Server URL',
                          hintText: 'https://crm.hltrn.cc',
                          prefixIcon: Icon(Icons.dns_outlined),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ModeTab extends StatelessWidget {
  final String label;
  final bool isActive;
  final VoidCallback onTap;

  const _ModeTab({required this.label, required this.isActive, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: isActive ? GodTheme.primary.withOpacity(0.15) : GodTheme.surfaceLight,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isActive ? GodTheme.primary : GodTheme.border,
          ),
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: isActive ? GodTheme.primary : GodTheme.textSecondary,
            fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
          ),
        ),
      ),
    );
  }
}
