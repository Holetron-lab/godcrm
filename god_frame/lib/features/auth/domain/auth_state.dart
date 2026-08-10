/// User profile data from GOD CRM.
class UserProfile {
  final int id;
  final String email;
  final String name;
  final String? avatar;
  final String? role;

  const UserProfile({
    required this.id,
    required this.email,
    required this.name,
    this.avatar,
    this.role,
  });

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      id: json['id'] ?? 0,
      email: json['email'] ?? '',
      name: json['name'] ?? json['email']?.split('@').first ?? 'User',
      avatar: json['avatar'],
      role: json['role'],
    );
  }
}

/// Authentication state.
sealed class AuthState {
  const AuthState();

  bool get isAuthenticated => this is Authenticated;
  bool get isLoading => this is AuthLoading;

  UserProfile? get user {
    if (this is Authenticated) return (this as Authenticated).user;
    return null;
  }
}

class AuthInitial extends AuthState {
  const AuthInitial();
}

class AuthLoading extends AuthState {
  const AuthLoading();
}

class Authenticated extends AuthState {
  @override
  final UserProfile user;
  const Authenticated(this.user);
}

class Unauthenticated extends AuthState {
  final String? message;
  const Unauthenticated([this.message]);
}

class AuthError extends AuthState {
  final String message;
  const AuthError(this.message);
}
