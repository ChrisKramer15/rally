import '../models/holding.dart';
import '../models/portfolio_summary.dart';
import '../models/result.dart';

/// Abstract interface for managing user portfolio holdings and calculations.
///
/// Handles adding/removing holdings with validation, retrieving current
/// holdings, and recalculating portfolio values when prices change.
abstract class IPortfolioTracker {
  /// Add or update a holding in the portfolio.
  ///
  /// Validates that [symbol] is non-empty, [quantity] is in
  /// [0.0001, 999999999] with up to 4 decimal places, and
  /// [averagePurchasePrice] is in [0.01, 999999999.99] with up to 2
  /// decimal places.
  ///
  /// If the symbol already exists, recalculates the weighted average
  /// purchase price: (Q1*P1 + Q2*P2) / (Q1+Q2).
  ///
  /// Returns a [Result] containing the updated [Holding] on success,
  /// or field-specific error messages on failure.
  Result<Holding> addHolding({
    required String symbol,
    required double quantity,
    required double averagePurchasePrice,
  });

  /// Get all current holdings in the portfolio.
  List<Holding> getHoldings();

  /// Recalculate portfolio values with updated [currentPrices].
  ///
  /// The [currentPrices] map is keyed by asset symbol with current market
  /// price as the value. Returns a [PortfolioSummary] with computed
  /// total value and unrealized gain/loss for each holding.
  PortfolioSummary recalculate(Map<String, double> currentPrices);

  /// Remove a holding identified by [symbol] from the portfolio.
  ///
  /// Returns a [Result] indicating success or failure (e.g., symbol not
  /// found).
  Result<void> removeHolding(String symbol);
}
