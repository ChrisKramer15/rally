import 'package:equatable/equatable.dart';

/// A portfolio holding representing an asset position.
class Holding extends Equatable {
  /// The asset ticker symbol.
  final String symbol;

  /// Quantity held (0.0001 to 999,999,999, up to 4 decimal places).
  final double quantity;

  /// Weighted average purchase price (0.01 to 999,999,999.99, up to 2 decimal places).
  final double averagePurchasePrice;

  /// Current market price, null if not yet fetched.
  final double? currentPrice;

  /// Timestamp of the last price update.
  final DateTime? lastPriceUpdate;

  const Holding({
    required this.symbol,
    required this.quantity,
    required this.averagePurchasePrice,
    this.currentPrice,
    this.lastPriceUpdate,
  });

  /// Creates a copy with updated fields.
  Holding copyWith({
    String? symbol,
    double? quantity,
    double? averagePurchasePrice,
    double? currentPrice,
    DateTime? lastPriceUpdate,
  }) {
    return Holding(
      symbol: symbol ?? this.symbol,
      quantity: quantity ?? this.quantity,
      averagePurchasePrice: averagePurchasePrice ?? this.averagePurchasePrice,
      currentPrice: currentPrice ?? this.currentPrice,
      lastPriceUpdate: lastPriceUpdate ?? this.lastPriceUpdate,
    );
  }

  @override
  List<Object?> get props => [
        symbol,
        quantity,
        averagePurchasePrice,
        currentPrice,
        lastPriceUpdate,
      ];
}
