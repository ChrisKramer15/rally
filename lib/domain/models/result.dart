/// A generic Result type for operation outcomes with success/error states.
sealed class Result<T> {
  const Result();

  /// Returns true if this is a successful result.
  bool get isSuccess => this is Success<T>;

  /// Returns true if this is a failure result.
  bool get isFailure => this is Failure<T>;

  /// Returns the value if success, otherwise throws.
  T get value {
    switch (this) {
      case Success<T>(:final value):
        return value;
      case Failure<T>(:final error):
        throw StateError('Cannot get value from Failure: $error');
    }
  }

  /// Returns the error message if failure, otherwise throws.
  String get error {
    switch (this) {
      case Success<T>():
        throw StateError('Cannot get error from Success');
      case Failure<T>(:final error):
        return error;
    }
  }

  /// Fold the result into a single value.
  R fold<R>({
    required R Function(T value) onSuccess,
    required R Function(String error) onFailure,
  }) {
    switch (this) {
      case Success<T>(:final value):
        return onSuccess(value);
      case Failure<T>(:final error):
        return onFailure(error);
    }
  }
}

/// Represents a successful operation result containing a value.
class Success<T> extends Result<T> {
  @override
  final T value;

  const Success(this.value);
}

/// Represents a failed operation result containing an error message.
class Failure<T> extends Result<T> {
  @override
  final String error;

  const Failure(this.error);
}
