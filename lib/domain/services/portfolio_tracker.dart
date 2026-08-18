import '../models/holding.dart';
import '../models/portfolio_summary.dart';
import '../models/result.dart';
import 'i_portfolio_tracker.dart';

/// Concrete implementation of [IPortfolioTracker].
///
/// Uses an internal `Map<String, Holding>` to store holdings keyed by symbol.
/// Validates inputs on addHolding and returns all validation errors at once.
class PortfolioTracker implements IPortfolioTracker {
  final Map<String, Holding> _holdings = {};

  @override
  Result<Holding> addHolding({
    required String symbol,
    required double quantity,
    required double averagePurchasePrice,
  }) {
    final errors = <String>[];

    // Validate symbol
    if (symbol.isEmpty) {
      errors.add('symbol: must not be empty');
    }

    // Validate quantity
    if (quantity < 0.0001 || quantity > 999999999) {
      errors.add('quantity: must be between 0.0001 and 999999999');
    } else if (_decimalPlaces(quantity) > 4) {
      errors.add('quantity: must have at most 4 decimal places');
    }

    // Validate averagePurchasePrice
    if (averagePurchasePrice < 0.01 || averagePurchasePrice > 999999999.99) {
      errors.add(
          'averagePurchasePrice: must be between 0.01 and 999999999.99');
    } else if (_decimalPlaces(averagePurchasePrice) > 2) {
      errors.add(
          'averagePurchasePrice: must have at most 2 decimal places');
    }

    if (errors.isNotEmpty) {
      return Failure(errors.join('; '));
    }

    // Check for existing holding and compute weighted average
    if (_holdings.containsKey(symbol)) {
      final existing = _holdings[symbol]!;
      final q1 = existing.quantity;
      final p1 = existing.averagePurchasePrice;
      final q2 = quantity;
      final p2 = averagePurchasePrice;

      final newQuantity = q1 + q2;
      final newAvgPrice = (q1 * p1 + q2 * p2) / newQuantity;

      final updated = Holding(
        symbol: symbol,
        quantity: newQuantity,
        averagePurchasePrice: newAvgPrice,
        currentPrice: existing.currentPrice,
        lastPriceUpdate: existing.lastPriceUpdate,
      );
      _holdings[symbol] = updated;
      return Success(updated);
    }

    // New holding
    final holding = Holding(
      symbol: symbol,
      quantity: quantity,
      averagePurchasePrice: averagePurchasePrice,
    );
    _holdings[symbol] = holding;
    return Success(holding);
  }

  @override
  List<Holding> getHoldings() {
    return _holdings.values.toList();
  }

  @override
  Result<void> removeHolding(String symbol) {
    if (!_holdings.containsKey(symbol)) {
      return Failure('symbol: holding not found for "$symbol"');
    }
    _holdings.remove(symbol);
    return const Success(null);
  }

  @override
  PortfolioSummary recalculate(Map<String, double> currentPrices) {
    final valuations = <HoldingValuation>[];
    double totalValue = 0;
    double totalGainLoss = 0;

    for (final holding in _holdings.values) {
      final currentPrice = currentPrices[holding.symbol];
      if (currentPrice == null) {
        // No price available — include with zero valuation
        valuations.add(HoldingValuation(
          holding: holding,
          totalValue: 0,
          unrealizedGainLoss: 0,
        ));
        continue;
      }

      // Update the holding with the current price
      final updatedHolding = holding.copyWith(
        currentPrice: currentPrice,
        lastPriceUpdate: DateTime.now(),
      );
      _holdings[holding.symbol] = updatedHolding;

      // totalValue = currentPrice * quantity, rounded to 2 decimal places
      final holdingTotalValue =
          _roundTo2(currentPrice * holding.quantity);

      // unrealizedGainLoss = (currentPrice - avgPrice) * quantity, rounded to 2 dp
      final unrealizedGainLoss = _roundTo2(
          (currentPrice - holding.averagePurchasePrice) * holding.quantity);

      valuations.add(HoldingValuation(
        holding: updatedHolding,
        totalValue: holdingTotalValue,
        unrealizedGainLoss: unrealizedGainLoss,
      ));

      totalValue += holdingTotalValue;
      totalGainLoss += unrealizedGainLoss;
    }

    return PortfolioSummary(
      holdings: valuations,
      totalValue: _roundTo2(totalValue),
      totalGainLoss: _roundTo2(totalGainLoss),
    );
  }

  /// Counts the number of decimal places in a double's string representation.
  int _decimalPlaces(double value) {
    final str = value.toString();

    // Handle scientific notation (e.g., 1e-5)
    if (str.contains('e') || str.contains('E')) {
      // Parse the exponent to determine decimal places
      final parts = str.toLowerCase().split('e');
      final mantissa = parts[0];
      final exponent = int.parse(parts[1]);

      // Count decimal places in the mantissa
      int mantissaDecimals = 0;
      if (mantissa.contains('.')) {
        mantissaDecimals = mantissa.split('.')[1].length;
      }

      // For negative exponents, decimal places = mantissaDecimals - exponent
      if (exponent < 0) {
        return mantissaDecimals - exponent;
      }
      // For positive exponents, subtract from mantissa decimals
      return (mantissaDecimals - exponent).clamp(0, mantissaDecimals);
    }

    if (!str.contains('.')) {
      return 0;
    }

    final decimalPart = str.split('.')[1];

    // Remove trailing zeros for counting significant decimal places
    final trimmed = decimalPart.replaceAll(RegExp(r'0+$'), '');
    return trimmed.length;
  }

  /// Rounds a double to 2 decimal places.
  double _roundTo2(double value) {
    return double.parse(value.toStringAsFixed(2));
  }
}
