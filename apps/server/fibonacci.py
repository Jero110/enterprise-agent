a, b = 0, 1
for _ in range(1000):
    print(a)
    a, b = b, a + b
