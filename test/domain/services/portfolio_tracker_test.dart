import 'package:flutter_test/flutter_test.dart';
import 'package:rally/domain/models/result.dart';
import 'package:rally/domain/services/portfolio_tracker.dart';

void main() {
  late PortfolioTracker tracker;

  setUp(() {
    tracker = PortfolioTracker();
  });

  group('addHolding - validation', () {
    test('rejects empty symbol', () {
      final result = tracker.addHolding(
        symbol: '',
        quantity: 10,
        averagePurchasePrice: 50.00,
      );
      expect(result.isFailure, isTrue);
      expect(result.error, contains('symbol'));
    });

    test('rejects quantity below minimum', () {
      final result = tracker.addHolding(
        symbol: 'AAPL',
        quantity: 0.00001,
        averagePurchasePrice: 150.00,
      );
      expect(result.isFailure, isTrue);
      expect(result.error, contains('quantity'));
    });

    test('rejects quantity above maximum', () {
      final result = tracker.addHolding(
        symbol: 'AAPL',
        quantity: 1000000000,
        averagePurchasePrice: 150.00,
      );
      expect(result.isFailure, isTrue);
      expect(result.error, contains('quantity'));
    });

    test('rejects quantity with more than 4 decimal places', () {
      final result = tracker.addHolding(
        symbol: 'AAPL',
        quantity: 1.12345,
        averagePurchasePrice: 150.00,
      );
      expect(result.isFailure, isTrue);
      expect(result.error, contains('quantity'));
    });

    test('rejects price below minimum', () {
      final result = tracker.addHolding(
        symbol: 'AAPL',
        quantity: 10,
        averagePurchasePrice: 0.001,
      );
      expect(result.isFailure, isTrue);
      expect(result.error, contains('averagePurchasePrice'));
    });

    test('rejects price above maximum', () {
      final result = tracker.addHolding(
        symbol: 'AAPL',
        quantity: 10,
        averagePurchasePrice: 1000000000.00,
      );
      expect(result.isFailure, isTrue);
      expect(result.error, contains('averagePurchasePrice'));
    });

    test('rejects price with more than 2 decimal places', () {
      final result = tracker.addHolding(
        symbol: 'AAPL',
        quantity: 10,
        averagePurchasePrice: 150.123,
      );
      expect(result.isFailure, isTrue);
      expect(result.error, contains('averagePurchasePrice'));
    });

    test('returns all validation errors at once', () {
      final result = tracker.addHolding(
        symbol: '',
        quantity: 0,
        averagePurchasePrice: 0,
      );
      expect(result.isFailure, isTrue);
      expect(result.error, contains('symbol'));
      expect(result.error, contains('quantity'));
      expect(result.error, contains('averagePurchasePrice'));
    });

    test('accepts valid inputs at boundaries', () {
      final result = tracker.addHolding(
        symbol: 'BTC',
        quantity: 0.0001,
        averagePurchasePrice: 0.01,
      );
      expect(result.isSuccess, isTrue);
      expect(result.value.symbol, equals('BTC'));
      expect(result.value.quantity, equals(0.0001));
      expect(result.value.averagePurchasePrice, equals(0.01));
    });

    test('accepts valid inputs at upper boundaries', () {
      final result = tracker.addHolding(
        symbol: 'AAPL',
        quantity: 999999999,
        averagePurchasePrice: 999999999.99,
      );
      expect(result.isSuccess, isTrue);
    });
  });

  group('addHolding - weighted average for duplicates', () {
    test('recalculates weighted average for existing symbol', () {
      tracker.addHolding(
        symbol: 'AAPL',
        quantity: 10,
        averagePurchasePrice: 100.00,
      );

      final result = tracker.addHolding(
        symbol: 'AAPL',
        quantity: 10,
        averagePurchasePrice: 200.00,
      );

      expect(result.isSuccess, isTrue);
      expect(result.value.quantity, equals(20));
      // Weighted avg: (10*100 + 10*200) / 20 = 150
      expect(result.value.averagePurchasePrice, equals(150.00));
    });

    test('weighted average with unequal quantities', () {
      tracker.addHolding(
        symbol: 'TSLA',
        quantity: 5,
        averagePurchasePrice: 200.00,
      );

      final result = tracker.addHolding(
        symbol: 'TSLA',
        quantity: 15,
        averagePurchasePrice: 300.00,
      );

      expect(result.isSuccess, isTrue);
      expect(result.value.quantity, equals(20));
      // Weighted avg: (5*200 + 15*300) / 20 = (1000 + 4500) / 20 = 275
      expect(result.value.averagePurchasePrice, equals(275.00));
    });
  });

  group('getHoldings', () {
    test('returns empty list when no holdings', () {
      expect(tracker.getHoldings(), isEmpty);
    });

    test('returns all added holdings', () {
      tracker.addHolding(
        symbol: 'AAPL',
        quantity: 10,
        averagePurchasePrice: 150.00,
      );
      tracker.addHolding(
        symbol: 'GOOG',
        quantity: 5,
        averagePurchasePrice: 2800.00,
      );

      final holdings = tracker.getHoldings();
      expect(holdings.length, equals(2));
      expect(holdings.map((h) => h.symbol).toSet(), equals({'AAPL', 'GOOG'}));
    });
  });

  group('removeHolding', () {
    test('removes existing holding', () {
      tracker.addHolding(
        symbol: 'AAPL',
        quantity: 10,
        averagePurchasePrice: 150.00,
      );

      final result = tracker.removeHolding('AAPL');
      expect(result.isSuccess, isTrue);
      expect(tracker.getHoldings(), isEmpty);
    });

    test('returns failure for non-existent symbol', () {
      final result = tracker.removeHolding('AAPL');
      expect(result.isFailure, isTrue);
      expect(result.error, contains('AAPL'));
    });
  });

  group('recalculate', () {
    test('computes totalValue and unrealizedGainLoss', () {
      tracker.addHolding(
        symbol: 'AAPL',
        quantity: 10,
        averagePurchasePrice: 100.00,
      );

      final summary = tracker.recalculate({'AAPL': 150.00});

      expect(summary.holdings.length, equals(1));
      final valuation = summary.holdings.first;
      // totalValue = 150 * 10 = 1500
      expect(valuation.totalValue, equals(1500.00));
      // unrealizedGainLoss = (150 - 100) * 10 = 500
      expect(valuation.unrealizedGainLoss, equals(500.00));
      expect(summary.totalValue, equals(1500.00));
      expect(summary.totalGainLoss, equals(500.00));
    });

    test('rounds values to 2 decimal places', () {
      tracker.addHolding(
        symbol: 'BTC',
        quantity: 3,
        averagePurchasePrice: 33.33,
      );

      final summary = tracker.recalculate({'BTC': 44.44});

      final valuation = summary.holdings.first;
      // totalValue = 44.44 * 3 = 133.32
      expect(valuation.totalValue, equals(133.32));
      // unrealizedGainLoss = (44.44 - 33.33) * 3 = 11.11 * 3 = 33.33
      expect(valuation.unrealizedGainLoss, equals(33.33));
    });

    test('handles missing price by using zero valuation', () {
      tracker.addHolding(
        symbol: 'AAPL',
        quantity: 10,
        averagePurchasePrice: 100.00,
      );

      final summary = tracker.recalculate({});

      expect(summary.holdings.first.totalValue, equals(0));
      expect(summary.holdings.first.unrealizedGainLoss, equals(0));
    });
  });
}
