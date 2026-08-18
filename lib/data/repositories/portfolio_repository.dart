import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../../domain/models/holding.dart';

/// Key used to store portfolio holdings in SharedPreferences.
const String _portfolioHoldingsKey = 'portfolio_holdings';

/// Repository for persisting portfolio holdings to local storage using
/// SharedPreferences.
///
/// Holdings are stored as a JSON-encoded list under the key
/// [_portfolioHoldingsKey]. Handles corrupted or missing data gracefully
/// by returning an empty list.
class PortfolioRepository {
  PortfolioRepository({required SharedPreferences sharedPreferences})
      : _prefs = sharedPreferences;

  final SharedPreferences _prefs;

  /// Saves the provided [holdings] list to local storage as JSON.
  ///
  /// Each holding is serialized with: symbol, quantity, averagePurchasePrice,
  /// currentPrice (nullable), and lastPriceUpdate (nullable).
  Future<void> saveHoldings(List<Holding> holdings) async {
    final jsonList = holdings.map(_holdingToJson).toList();
    final encoded = jsonEncode(jsonList);
    await _prefs.setString(_portfolioHoldingsKey, encoded);
  }

  /// Loads portfolio holdings from local storage.
  ///
  /// Returns an empty list if no data exists or if the stored data is
  /// corrupted/unparseable.
  Future<List<Holding>> loadHoldings() async {
    try {
      final encoded = _prefs.getString(_portfolioHoldingsKey);
      if (encoded == null) {
        return [];
      }

      final decoded = jsonDecode(encoded);
      if (decoded is! List) {
        return [];
      }

      final holdings = <Holding>[];
      for (final item in decoded) {
        if (item is Map<String, dynamic>) {
          final holding = _holdingFromJson(item);
          if (holding != null) {
            holdings.add(holding);
          }
        }
      }
      return holdings;
    } catch (_) {
      // Corrupted or invalid data — return empty list.
      return [];
    }
  }

  /// Serializes a [Holding] to a JSON-compatible map.
  Map<String, dynamic> _holdingToJson(Holding holding) {
    return {
      'symbol': holding.symbol,
      'quantity': holding.quantity,
      'averagePurchasePrice': holding.averagePurchasePrice,
      'currentPrice': holding.currentPrice,
      'lastPriceUpdate': holding.lastPriceUpdate?.toIso8601String(),
    };
  }

  /// Deserializes a [Holding] from a JSON map.
  ///
  /// Returns null if required fields are missing or invalid.
  Holding? _holdingFromJson(Map<String, dynamic> json) {
    try {
      final symbol = json['symbol'];
      final quantity = json['quantity'];
      final averagePurchasePrice = json['averagePurchasePrice'];

      if (symbol is! String || symbol.isEmpty) return null;
      if (quantity is! num) return null;
      if (averagePurchasePrice is! num) return null;

      final currentPrice = json['currentPrice'];
      final lastPriceUpdateRaw = json['lastPriceUpdate'];

      DateTime? lastPriceUpdate;
      if (lastPriceUpdateRaw is String) {
        lastPriceUpdate = DateTime.tryParse(lastPriceUpdateRaw);
      }

      return Holding(
        symbol: symbol,
        quantity: quantity.toDouble(),
        averagePurchasePrice: averagePurchasePrice.toDouble(),
        currentPrice: currentPrice is num ? currentPrice.toDouble() : null,
        lastPriceUpdate: lastPriceUpdate,
      );
    } catch (_) {
      return null;
    }
  }
}
