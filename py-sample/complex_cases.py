from parents import Base, Mixin
import parents as p

# Case 1: Standard
class StandardChild(Base):
    def speak(self):
        pass

# Case 2: Multi-line
class MultiLineChild(
    Base,
    Mixin
):
    def speak(self):
        pass
    def walk(self):
        pass

# Case 3: Aliased
class AliasedChild(p.Base):
    def speak(self):
        pass

# Case 4: Multiple
class MultipleChild(Base, Mixin):
    def speak(self):
        pass

# Case 5: Nested Child
class NestedParent(MultiLineChild):
    ...

class NestedChild(NestedParent):
    def speak(self):
        pass
    def walk(self):
        pass

# Case 6: Sandwich (Both overrides and is overridden)
class Bread:
    def taste(self):
        pass

# Case 6.1: Sandwich (Both overrides and is overridden)
class Sandwich(Bread):
    def taste(self):
        pass

class Toast(Sandwich):
    def taste(self):
        pass