import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:rally/data/repositories/portfolio_repository.dart';
import 'package:rally/domain/models/holding.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Future<PortfolioRepository> createRepository(
      {Map<String, Object>? values}) async {
    SharedPreferences.setMockInitialValues(values ?? {});
    final prefs = await SharedPreferences.getInstance();
    return PortfolioRepository(sharedPreferences: prefs);
  }

  group('PortfolioRepository', () {
    group('loadHoldings', () {
      test('returns empty list when no data exists', () async {
        final repo = await createRepository();
        final holdings = await repo.loadHoldings();
        expect(holdings, isEmpty);
      });

      test('returns empty list when stored data is corrupted', () async {
        final repo = await createRepository(
            values: {'portfolio_holdings': 'not valid json {'});
        final holdings = await repo.loadHoldings();
        expect(holdings, isEmpty);
      });

      test('returns empty list when stored data is not a list', () async {
        final repo = await createRepository(
            values: {'portfolio_holdings': jsonEncode({'key': 'value'})});
        final holdings = await repo.loadHoldings();
        expect(holdings, isEmpty);
      });

      test('skips entries with missing required fields', () async {
        final data = jsonEncode([
          {'symbol': 'AAPL', 'quantity': 10.0, 'averagePurchasePrice': 150.0},
          {'quantity': 5.0, 'averagePurchasePrice': 100.0}, // missing symbol
          {'symbol': 'GOOG', 'averagePurchasePrice': 100.0}, // missing quantity
        ]);
        final repo =
            await createRepository(values: {'portfolio_holdings': data});
        final holdings = await repo.loadHoldings();
        expect(holdings.length, 1);
        expect(holdings[0].symbol, 'AAPL');
      });

      test('skips entries with empty symbol', () async {
        final data = jsonEncode([
          {'symbol': '', 'quantity': 10.0, 'averagePurchasePrice': 150.0},
        ]);
        final repo =
            await createRepository(values: {'portfolio_holdings': data});
        final holdings = await repo.loadHoldings();
        expect(holdings, isEmpty);
      });

      test('loads holdings with all fields including nullable ones', () async {
        final data = jsonEncode([
          {
            'symbol': 'AAPL',
            'quantity': 10.5,
            'averagePurchasePrice': 150.25,
            'currentPrice': 155.50,
            'lastPriceUpdate': '2024-01-15T10:30:00.000Z',
          },
        ]);
        final repo =
            await createRepository(values: {'portfolio_holdings': data});
        final holdings = await repo.loadHoldings();

        expect(holdings.length, 1);
        expect(holdings[0].symbol, 'AAPL');
        expect(holdings[0].quantity, 10.5);
        expect(holdings[0].averagePurchasePrice, 150.25);
        expect(holdings[0].currentPrice, 155.50);
        expect(holdings[0].lastPriceUpdate, DateTime.utc(2024, 1, 15, 10, 30));
      });

      test('loads holdings with null optional fields', () async {
        final data = jsonEncode([
          {
            'symbol': 'TSLA',
            'quantity': 5.0,
            'averagePurchasePrice': 200.00,
            'currentPrice': null,
            'lastPriceUpdate': null,
          },
        ]);
        final repo =
            await createRepository(values: {'portfolio_holdings': data});
        final holdings = await repo.loadHoldings();

        expect(holdings.length, 1);
        expect(holdings[0].currentPrice, isNull);
        expect(holdings[0].lastPriceUpdate, isNull);
      });
    });

    group('saveHoldings', () {
      test('saves empty list', () async {
        final repo = await createRepository();
        await repo.saveHoldings([]);

        final prefs = await SharedPreferences.getInstance();
        final stored = prefs.getString('portfolio_holdings');
        expect(stored, jsonEncode([]));
      });

      test('saves holdings with all fields', () async {
        final repo = await createRepository();
        final holdings = [
          Holding(
            symbol: 'AAPL',
            quantity: 10.5,
            averagePurchasePrice: 150.25,
            currentPrice: 155.50,
            lastPriceUpdate: DateTime.utc(2024, 1, 15, 10, 30),
          ),
        ];
        await repo.saveHoldings(holdings);

        final prefs = await SharedPreferences.getInstance();
        final stored = prefs.getString('portfolio_holdings');
        final decoded = jsonDecode(stored!) as List;
        expect(decoded.length, 1);
        expect(decoded[0]['symbol'], 'AAPL');
        expect(decoded[0]['quantity'], 10.5);
        expect(decoded[0]['averagePurchasePrice'], 150.25);
        expect(decoded[0]['currentPrice'], 155.50);
        expect(decoded[0]['lastPriceUpdate'], '2024-01-15T10:30:00.000Z');
      });

      test('saves holdings with null optional fields', () async {
        final repo = await createRepository();
        final holdings = [
          const Holding(
            symbol: 'TSLA',
            quantity: 5.0,
            averagePurchasePrice: 200.00,
          ),
        ];
        await repo.saveHoldings(holdings);

        final prefs = await SharedPreferences.getInstance();
        final stored = prefs.getString('portfolio_holdings');
        final decoded = jsonDecode(stored!) as List;
        expect(decoded[0]['currentPrice'], isNull);
        expect(decoded[0]['lastPriceUpdate'], isNull);
      });
    });

    group('round-trip', () {
      test('save then load returns same holdings', () async {
        final repo = await createRepository();
        final original = [
          Holding(
            symbol: 'AAPL',
            quantity: 10.5,
            averagePurchasePrice: 150.25,
            currentPrice: 155.50,
            lastPriceUpdate: DateTime.utc(2024, 1, 15, 10, 30),
          ),
          const Holding(
            symbol: 'GOOG',
            quantity: 3.0,
            averagePurchasePrice: 2800.00,
          ),
        ];

        await repo.saveHoldings(original);
        final loaded = await repo.loadHoldings();

        expect(loaded.length, 2);
        expect(loaded[0], original[0]);
        expect(loaded[1], original[1]);
      });

      test('save then load preserves data across new repository instance',
          () async {
        final repo = await createRepository();
        final original = [
          const Holding(
            symbol: 'BTC',
            quantity: 0.5,
            averagePurchasePrice: 45000.00,
          ),
        ];

        await repo.saveHoldings(original);

        // Simulate app restart by creating a new repository with same prefs
        final prefs = await SharedPreferences.getInstance();
        final newRepo = PortfolioRepository(sharedPreferences: prefs);
        final loaded = await newRepo.loadHoldings();

        expect(loaded.length, 1);
        expect(loaded[0].symbol, 'BTC');
        expect(loaded[0].quantity, 0.5);
        expect(loaded[0].averagePurchasePrice, 45000.00);
      });
    });
  });
}
