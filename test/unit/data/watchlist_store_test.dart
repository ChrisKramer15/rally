import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:rally/data/services/watchlist_store.dart';
import 'package:rally/domain/models/watchlist_change_result.dart';

void main() {
  late WatchlistStore store;

  /// Helper to create a WatchlistStore with the given initial values.
  Future<WatchlistStore> createStoreAsync({List<String>? initialSymbols}) async {
    final values = <String, Object>{};
    if (initialSymbols != null) {
      values['watchlist_symbols'] = initialSymbols;
    }
    SharedPreferences.setMockInitialValues(values);
    final prefs = await SharedPreferences.getInstance();
    return WatchlistStore(prefs: prefs);
  }

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    store = await createStoreAsync();
  });

  group('WatchlistStore', () {
    group('addSymbol', () {
      test('adding a symbol successfully returns WatchlistSymbolAdded', () async {
        final result = await store.addSymbol('AAPL');

        expect(result, isA<WatchlistSymbolAdded>());
        expect((result as WatchlistSymbolAdded).symbol, 'AAPL');
        expect(store.getWatchlist(), contains('AAPL'));
      });

      test('adding a duplicate symbol returns WatchlistAlreadyExists', () async {
        await store.addSymbol('AAPL');
        final result = await store.addSymbol('AAPL');

        expect(result, isA<WatchlistAlreadyExists>());
        expect((result as WatchlistAlreadyExists).symbol, 'AAPL');
        // Should still only appear once
        expect(
          store.getWatchlist().where((s) => s == 'AAPL').length,
          1,
        );
      });

      test('adding when at capacity (50) returns WatchlistAtCapacity', () async {
        final symbols = List.generate(50, (i) => 'SYM$i');
        store = await createStoreAsync(initialSymbols: symbols);

        final result = await store.addSymbol('EXTRA');

        expect(result, isA<WatchlistAtCapacity>());
        expect(store.getWatchlist().length, 50);
        expect(store.getWatchlist(), isNot(contains('EXTRA')));
      });

      test('capacity boundary: can add at 49, cannot add at 50', () async {
        final symbols = List.generate(49, (i) => 'SYM$i');
        store = await createStoreAsync(initialSymbols: symbols);

        // Adding the 50th symbol should succeed
        final result49 = await store.addSymbol('FIFTIETH');
        expect(result49, isA<WatchlistSymbolAdded>());
        expect(store.getWatchlist().length, 50);

        // Adding the 51st symbol should fail
        final result50 = await store.addSymbol('FIFTY_ONE');
        expect(result50, isA<WatchlistAtCapacity>());
        expect(store.getWatchlist().length, 50);
        expect(store.getWatchlist(), isNot(contains('FIFTY_ONE')));
      });

      test('empty string symbol is accepted (current implementation does not reject)', () async {
        // Document: The current implementation does not validate against empty strings.
        // This test documents the existing behavior.
        final result = await store.addSymbol('');

        expect(result, isA<WatchlistSymbolAdded>());
        expect((result as WatchlistSymbolAdded).symbol, '');
        expect(store.getWatchlist(), contains(''));
      });

      test('adding empty string twice returns WatchlistAlreadyExists', () async {
        await store.addSymbol('');
        final result = await store.addSymbol('');

        expect(result, isA<WatchlistAlreadyExists>());
        expect((result as WatchlistAlreadyExists).symbol, '');
      });
    });

    group('removeSymbol', () {
      test('removing a symbol successfully returns WatchlistSymbolRemoved', () async {
        await store.addSymbol('AAPL');
        final result = await store.removeSymbol('AAPL');

        expect(result, isA<WatchlistSymbolRemoved>());
        expect((result as WatchlistSymbolRemoved).symbol, 'AAPL');
        expect(store.getWatchlist(), isNot(contains('AAPL')));
      });

      test('removing a non-existent symbol returns WatchlistSymbolRemoved', () async {
        // The current implementation does not check existence before removing.
        // List.remove() on a non-existent item is a no-op, then it persists.
        final result = await store.removeSymbol('NONEXISTENT');

        expect(result, isA<WatchlistSymbolRemoved>());
        expect((result as WatchlistSymbolRemoved).symbol, 'NONEXISTENT');
      });

      test('removing reduces the watchlist length by one', () async {
        await store.addSymbol('AAPL');
        await store.addSymbol('GOOG');
        expect(store.getWatchlist().length, 2);

        await store.removeSymbol('AAPL');
        expect(store.getWatchlist().length, 1);
        expect(store.getWatchlist(), ['GOOG']);
      });
    });

    group('getWatchlist', () {
      test('returns an unmodifiable list', () async {
        await store.addSymbol('AAPL');
        final watchlist = store.getWatchlist();

        expect(
          () => watchlist.add('HACK'),
          throwsA(isA<UnsupportedError>()),
        );
      });

      test('returns empty list when no symbols have been added', () {
        expect(store.getWatchlist(), isEmpty);
      });
    });

    group('contains', () {
      test('returns true for a symbol in the watchlist', () async {
        await store.addSymbol('TSLA');
        expect(store.contains('TSLA'), isTrue);
      });

      test('returns false for a symbol not in the watchlist', () {
        expect(store.contains('UNKNOWN'), isFalse);
      });

      test('is case-sensitive', () async {
        await store.addSymbol('AAPL');
        expect(store.contains('AAPL'), isTrue);
        expect(store.contains('aapl'), isFalse);
      });
    });

    group('isAtCapacity', () {
      test('returns false when below 50 symbols', () {
        expect(store.isAtCapacity(), isFalse);
      });

      test('returns false at 49 symbols', () async {
        final symbols = List.generate(49, (i) => 'SYM$i');
        store = await createStoreAsync(initialSymbols: symbols);

        expect(store.isAtCapacity(), isFalse);
      });

      test('returns true at exactly 50 symbols', () async {
        final symbols = List.generate(50, (i) => 'SYM$i');
        store = await createStoreAsync(initialSymbols: symbols);

        expect(store.isAtCapacity(), isTrue);
      });
    });

    group('persistence', () {
      test('symbols persist to SharedPreferences', () async {
        SharedPreferences.setMockInitialValues({});
        final prefs = await SharedPreferences.getInstance();
        final store1 = WatchlistStore(prefs: prefs);

        await store1.addSymbol('AAPL');
        await store1.addSymbol('GOOG');

        // Create a new store instance with the same prefs to simulate app restart
        final store2 = WatchlistStore(prefs: prefs);
        expect(store2.getWatchlist(), ['AAPL', 'GOOG']);
      });

      test('removed symbols are no longer persisted', () async {
        SharedPreferences.setMockInitialValues({});
        final prefs = await SharedPreferences.getInstance();
        final store1 = WatchlistStore(prefs: prefs);

        await store1.addSymbol('AAPL');
        await store1.addSymbol('GOOG');
        await store1.removeSymbol('AAPL');

        // Simulate app restart
        final store2 = WatchlistStore(prefs: prefs);
        expect(store2.getWatchlist(), ['GOOG']);
      });

      test('empty watchlist persists correctly', () async {
        SharedPreferences.setMockInitialValues({});
        final prefs = await SharedPreferences.getInstance();
        final store1 = WatchlistStore(prefs: prefs);

        await store1.addSymbol('AAPL');
        await store1.removeSymbol('AAPL');

        final store2 = WatchlistStore(prefs: prefs);
        expect(store2.getWatchlist(), isEmpty);
      });

      test('loads previously stored watchlist on construction', () async {
        SharedPreferences.setMockInitialValues({
          'watchlist_symbols': ['MSFT', 'TSLA', 'AMZN'],
        });
        final prefs = await SharedPreferences.getInstance();
        final loadedStore = WatchlistStore(prefs: prefs);

        expect(loadedStore.getWatchlist(), ['MSFT', 'TSLA', 'AMZN']);
      });
    });
  });
}
