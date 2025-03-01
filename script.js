// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAG3xjX_n_Bx0p8WOGYMqZz9wiL9yWSZSc",
    authDomain: "sbjr-agriculture-shop.firebaseapp.com",
    projectId: "sbjr-agriculture-shop",
    storageBucket: "sbjr-agriculture-shop.appspot.com",
    messagingSenderId: "364119868491",
    appId: "1:364119868491:web:bf66589b710e4f5d7f79ce",
    measurementId: "G-RSJHB63PX9"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Get Firebase services
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

let currentUser = null;
let cart = [];

// Utility Functions
function sanitizeInput(input) {
    return input.replace(/[<>&'"]/g, '');
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function handleFirebaseError(error, action) {
    const errorMessages = {
        'auth/email-already-in-use': `Email already in use during ${action}`,
        'auth/invalid-email': 'Invalid email format',
        'auth/weak-password': 'Password should be at least 6 characters',
        'auth/network-request-failed': 'Network error. Please check your connection',
        'storage/unauthorized': 'Unauthorized access to storage'
    };
    return errorMessages[error.code] || `Error during ${action}: ${error.message}`;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Theme Management
function toggleTheme() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}

function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

// Authentication Functions
function toggleAuthForm() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const forgotPasswordForm = document.getElementById('forgot-password-form');
    const authToggle = document.getElementById('auth-toggle');

    if (loginForm.style.display !== 'none') {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        forgotPasswordForm.style.display = 'none';
        authToggle.innerHTML = 'Already have an account? <a href="#" onclick="toggleAuthForm()">Login here</a>';
    } else {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        forgotPasswordForm.style.display = 'none';
        authToggle.innerHTML = 'New user? <a href="#" onclick="toggleAuthForm()">Register here</a>';
    }
}

auth.onAuthStateChanged(user => {
    console.log('Auth State Changed:');
    console.log('User:', user);
    console.log('UID:', user?.uid);
    console.log('Email:', user?.email);
    if (user) {
        db.collection('users').doc(user.uid).get().then(doc => {
            console.log('User Data:', doc.data());
        }).catch(error => {
            console.error('Error fetching user data:', error);
        });
    }
    
    if (user) {
        currentUser = user;
        loadCartFromFirestore().then(() => {
            document.getElementById('login-container').style.display = 'none';
            document.getElementById('home-container').style.display = 'block';
            checkAdminStatus(user.uid);
            checkOwnerStatus(user.uid);
            showHome();
        });
    } else {
        currentUser = null;
        cart = [];
        document.getElementById('login-container').style.display = 'block';
        document.getElementById('home-container').style.display = 'none';
        document.querySelector('.admin-only').style.display = 'none';
    }
});

function checkAdminStatus(uid) {
    db.collection('users').doc(uid).get().then(doc => {
        if (doc.exists && doc.data().isAdmin) {
            document.querySelector('.admin-only').style.display = 'inline-block';
        }
    }).catch(error => {
        showError(handleFirebaseError(error, 'admin status check'));
    });
}

function checkOwnerStatus(uid) {
    db.collection('users').doc(uid).get().then(doc => {
        if (doc.exists && doc.data().isOwner) {
            document.querySelector('.nav-link.owner-only').style.display = 'inline-block';
        }
    }).catch(error => {
        showError(handleFirebaseError(error, 'owner status check'));
    });
}

function login() {
    const email = sanitizeInput(document.getElementById('login-email').value.trim());
    const password = sanitizeInput(document.getElementById('login-password').value);
    
    if (!isValidEmail(email) || !password) {
        showError('Please enter a valid email and password');
        return;
    }
    
    showLoading(true);
    auth.signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
            return db.collection('users').doc(userCredential.user.uid).get();
        })
        .then((doc) => {
            if (doc.exists) {
                showSuccess(`Welcome back, ${doc.data().name || doc.data().email}!`);
            } else {
                auth.signOut();
                throw new Error('User account not found');
            }
        })
        .catch((error) => {
            showError(handleFirebaseError(error, 'login'));
        })
        .finally(() => showLoading(false));
}

function loginWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    showLoading(true);
    firebase.auth().signInWithPopup(provider)
        .then((result) => {
            return checkUserExists(result.user.email);
        })
        .then((userExists) => {
            if (userExists) {
                showSuccess('Logged in successfully with Google');
            } else {
                firebase.auth().signOut();
                showError("Please register first");
            }
        })
        .catch((error) => {
            showError(handleFirebaseError(error, 'Google login'));
        })
        .finally(() => showLoading(false));
}

function register() {
    const name = sanitizeInput(document.getElementById('register-name').value.trim());
    const email = sanitizeInput(document.getElementById('register-email').value.trim());
    const password = sanitizeInput(document.getElementById('register-password').value);
    const imageFile = document.getElementById('register-image').files[0];

    if (!name || !isValidEmail(email) || !password) {
        showError('Please fill in all fields with valid data');
        return;
    }

    showLoading(true);
    let createdUser;
    auth.createUserWithEmailAndPassword(email, password)
        .then((userCredential) => {
            createdUser = userCredential.user;
            return createUserProfile(createdUser, name);
        })
        .then(() => {
            if (imageFile) {
                return uploadProfileImage(createdUser, imageFile);
            }
            return createdUser;
        })
        .then((user) => {
            showSuccess('Registration successful! Welcome!');
            showHome();
        })
        .catch((error) => {
            showError(handleFirebaseError(error, 'registration'));
            if (createdUser) createdUser.delete().catch(console.error);
        })
        .finally(() => showLoading(false));
}

function registerWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    showLoading(true);
    firebase.auth().signInWithPopup(provider)
        .then((result) => {
            const user = result.user;
            return checkUserExists(user.email);
        })
        .then((userExists) => {
            if (userExists) {
                return firebase.auth().signOut().then(() => {
                    throw new Error("Account exists. Please login instead");
                });
            }
            return db.collection('users').doc(firebase.auth().currentUser.uid).set({
                name: firebase.auth().currentUser.displayName,
                email: firebase.auth().currentUser.email,
                photoURL: firebase.auth().currentUser.photoURL,
                isAdmin: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        })
        .then(() => {
            showSuccess('Registration successful with Google!');
            showHome();
        })
        .catch((error) => {
            showError(handleFirebaseError(error, 'Google registration'));
        })
        .finally(() => showLoading(false));
}

// Cart Functions
function saveCartToFirestore() {
    if (currentUser) {
        return db.collection('carts').doc(currentUser.uid).set({
            items: cart,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
}

function loadCartFromFirestore() {
    if (currentUser) {
        return db.collection('carts').doc(currentUser.uid).get()
            .then(doc => {
                if (doc.exists) {
                    cart = doc.data().items || [];
                    updateCartCount();
                }
            });
    }
}

function checkStockAvailability(productId, quantity) {
    return db.collection('products').doc(productId).get()
        .then(doc => {
            const stock = doc.data().stock || 0;
            return stock >= quantity;
        });
}

function addToCart(productId) {
    if (!currentUser) {
        showError('Please log in to add items to your cart');
        return;
    }
    
    showLoading(true);
    checkStockAvailability(productId, 1).then(available => {
        if (!available) {
            showError('Product is out of stock');
            return;
        }
        
        db.collection('products').doc(productId).get().then((doc) => {
            if (doc.exists) {
                const product = doc.data();
                const existingProductIndex = cart.findIndex(item => item.id === doc.id);
                if (existingProductIndex !== -1) {
                    cart[existingProductIndex].quantity += 1;
                } else {
                    cart.push({id: doc.id, ...product, quantity: 1});
                }
                updateCartCount();
                saveCartToFirestore();
                showSuccess('Product added to cart');
            }
        }).catch(error => {
            showError(handleFirebaseError(error, 'adding to cart'));
        }).finally(() => showLoading(false));
    });
}

function updateCartCount() {
    document.getElementById('cart-count').textContent = cart.reduce((sum, item) => sum + item.quantity, 0);
}

// UI Functions
function showHome() {
    showLoading(true);
    db.collection('users').doc(currentUser.uid).get().then(doc => {
        const userData = doc.data();
        db.collection('products').limit(3).get().then(querySnapshot => {
            let featuredProducts = '';
            querySnapshot.forEach(doc => {
                const product = doc.data();
                featuredProducts += `
                    <div class="featured-product">
                        <img src="${product.image}" alt="${product.name}" class="featured-product-image">
                        <h3>${product.name}</h3>
                        <p>â‚¹${product.price}</p>
                        <button onclick="showProductDetails('${doc.id}')" class="glow-button">View Details</button>
                    </div>
                `;
            });

            document.getElementById('content').innerHTML = `
                <div class="home-content">
                    <h2>Welcome, ${userData.name}!</h2>
                    <div class="featured-products">
                        <h3>Featured Products</h3>
                        <div class="featured-products-grid">${featuredProducts}</div>
                    </div>
                </div>
            `;
        });
    }).catch(error => {
        showError(handleFirebaseError(error, 'loading home'));
    }).finally(() => showLoading(false));
}

function showShop() {
    document.getElementById('content').innerHTML = `
        <h2>Shop</h2>
        <div id="search-bar" class="glass-panel">
            <input type="text" id="search-input" placeholder="Search products..." aria-label="Search products">
        </div>
        <div id="product-list" class="product-grid"></div>
    `;
    loadProducts();
    const debouncedSearch = debounce(liveSearch, 300);
    document.getElementById('search-input').addEventListener('input', debouncedSearch);
}

function loadProducts() {
    showLoading(true);
    db.collection('products').get().then((querySnapshot) => {
        let productsHtml = '';
        querySnapshot.forEach((doc) => {
            const product = doc.data();
            productsHtml += createProductCard(doc.id, product);
        });
        document.getElementById('product-list').innerHTML = productsHtml || '<p>No products available</p>';
    }).catch(error => {
        showError(handleFirebaseError(error, 'loading products'));
    }).finally(() => showLoading(false));
}

function createProductCard(id, product) {
    return `
        <div class="product-card">
            <a href="#" onclick="showProductDetails('${id}'); return false;">
                <img src="${product.image}" alt="${product.name}" class="product-image">
                <div class="product-title">${product.name}</div>
                <div class="product-price">â‚¹${product.price}</div>
                <div class="product-description">${product.description.substring(0, 50)}...</div>
            </a>
            <button onclick="addToCart('${id}')" class="add-to-cart">Add to Cart</button>
        </div>
    `;
}

function showProductDetails(productId) {
    showLoading(true);
    db.collection('products').doc(productId).get().then((doc) => {
        if (doc.exists) {
            const product = doc.data();
            document.getElementById('content').innerHTML = `
                <div class="product-details">
                    <img src="${product.image}" alt="${product.name}" class="product-detail-image">
                    <div class="product-info">
                        <h2>${product.name}</h2>
                        <p class="product-description">${product.description}</p>
                        <p class="product-price">â‚¹${product.price}</p>
                        <button onclick="addToCart('${doc.id}')" class="glow-button">Add to Cart</button>
                        <button onclick="showShop()" class="glow-button">Back to Shop</button>
                    </div>
                </div>
            `;
        }
    }).catch(error => {
        showError(handleFirebaseError(error, 'loading product details'));
    }).finally(() => showLoading(false));
}

function liveSearch() {
    const searchTerm = sanitizeInput(document.getElementById('search-input').value.toLowerCase().trim());
    
    if (!searchTerm) {
        loadProducts();
        return;
    }

    showLoading(true);
    db.collection('products').get().then((querySnapshot) => {
        let productsHtml = '';
        querySnapshot.forEach((doc) => {
            const product = doc.data();
            const searchableText = `${product.name} ${product.description}`.toLowerCase();
            if (searchableText.includes(searchTerm)) {
                productsHtml += createProductCard(doc.id, product);
            }
        });
        document.getElementById('product-list').innerHTML = productsHtml || '<p>No products found</p>';
    }).catch(error => {
        showError(handleFirebaseError(error, 'searching products'));
    }).finally(() => showLoading(false));
}

function showCart() {
    let content = '<h2>Shopping Cart</h2>';
    if (cart.length === 0) {
        content += '<p>Your cart is empty</p>';
    } else {
        let total = 0;
        content += '<div class="cart-items">';
        cart.forEach((product, index) => {
            const itemTotal = Number(product.price) * product.quantity;
            total += itemTotal;
            content += `
                <div class="cart-item">
                    <img src="${product.image}" alt="${product.name}" class="cart-item-image">
                    <div class="cart-item-details">
                        <h3>${product.name}</h3>
                        <p>Price: â‚¹${product.price}</p>
                        <div class="quantity-control">
                            <button onclick="updateCartItemQuantity(${index}, -1)" class="quantity-btn">-</button>
                            <span class="quantity">${product.quantity}</span>
                            <button onclick="updateCartItemQuantity(${index}, 1)" class="quantity-btn">+</button>
                        </div>
                        <p>Item Total: â‚¹${itemTotal.toFixed(2)}</p>
                        <button onclick="removeFromCart(${index})" class="remove-btn">Remove</button>
                    </div>
                </div>
            `;
        });
        content += `</div><div class="cart-summary">
            <h3>Total: â‚¹${total.toFixed(2)}</h3>
            <button onclick="checkout()" class="glow-button">Checkout</button>
        </div>`;
    }
    document.getElementById('content').innerHTML = content;
}

function updateCartItemQuantity(index, change) {
    cart[index].quantity += change;
    if (cart[index].quantity < 1) {
        cart.splice(index, 1);
    }
    updateCartCount();
    saveCartToFirestore();
    showCart();
}

function removeFromCart(index) {
    cart.splice(index, 1);
    updateCartCount();
    saveCartToFirestore();
    showCart();
}

function checkout() {
    if (cart.length === 0) {
        showError('Your cart is empty');
        return;
    }
    
    showLoading(true);
    const couponCode = generateCouponCode();
    const totalAmount = cart.reduce((total, item) => total + (item.price * item.quantity), 0);
    
    saveCouponToFirebase(couponCode, totalAmount)
        .then(() => {
            displayCouponCode(couponCode, totalAmount);
        })
        .catch(error => {
            showError(handleFirebaseError(error, 'checkout'));
        })
        .finally(() => showLoading(false));
}

function generateCouponCode() {
    return 'SBJR-' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

function saveCouponToFirebase(couponCode, amount) {
    return db.collection('coupons').add({
        code: couponCode,
        amount: amount,
        userEmail: currentUser.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        used: false,
        cartItems: cart.map(item => ({
            id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity
        }))
    });
}

function displayCouponCode(couponCode, amount) {
    let cartItemsHtml = cart.map(item => `
        <li>${item.name} - Quantity: ${item.quantity} - Price: â‚¹${(item.price * item.quantity).toFixed(2)}</li>
    `).join('');
    
    document.getElementById('content').innerHTML = `
        <h2>Checkout Complete</h2>
        <p>Total: â‚¹${amount.toFixed(2)}</p>
        <h3>Order Items:</h3>
        <ul>${cartItemsHtml}</ul>
        <p>Coupon Code: <span class="coupon-code">${couponCode}</span></p>
        <button onclick="copyCouponCode('${couponCode}')" class="glow-button">Copy Code</button>
    `;
}

function copyCouponCode(couponCode) {
    navigator.clipboard.writeText(couponCode).then(() => {
        showSuccess('Coupon copied! Cart cleared.');
        cart = [];
        updateCartCount();
        saveCartToFirestore();
        showHome();
    }).catch(err => {
        showError('Failed to copy coupon');
    });
}

// Profile Functions
function showProfile() {
    if (!currentUser) {
        showError('Please log in to view profile');
        return;
    }
    
    showLoading(true);
    db.collection('users').doc(currentUser.uid).get()
        .then(doc => {
            if (doc.exists) {
                const userData = doc.data();
                document.getElementById('content').innerHTML = `
                    <div class="profile-container">
                        <div class="profile-header">
                            <div class="profile-image-container">
                                <img id="profile-image" src="${userData.photoURL || 'https://via.placeholder.com/150'}" alt="Profile">
                                <input type="file" id="profile-image-input" accept="image/*" style="display: none;">
                                <button onclick="document.getElementById('profile-image-input').click()" class="change-image-btn">Change</button>
                            </div>
                            <div class="profile-name-email">
                                <h2>${userData.name}</h2>
                                <p>${userData.email}</p>
                            </div>
                        </div>
                        <div class="profile-details">
                            <div class="profile-field">
                                <span class="field-label">Name:</span>
                                <span class="field-value">${userData.name}</span>
                                <button onclick="editProfile('name')" class="edit-btn">Edit</button>
                            </div>
                            <div class="profile-field">
                                <span class="field-label">Email:</span>
                                <span class="field-value">${userData.email}</span>
                            </div>
                            <div class="profile-field">
                                <span class="field-label">Password:</span>
                                <span class="field-value">********</span>
                                <button onclick="editProfile('password')" class="edit-btn">Change</button>
                            </div>
                        </div>
                        <div class="profile-coupons">
                            <h3>Your Coupons</h3>
                            <div id="user-coupons">Loading...</div>
                        </div>
                    </div>
                `;
                document.getElementById('profile-image-input').addEventListener('change', handleProfileImageChange);
                loadUserCoupons();
            }
        })
        .catch(error => {
            showError(handleFirebaseError(error, 'loading profile'));
        })
        .finally(() => showLoading(false));
}

function handleProfileImageChange(event) {
    const file = event.target.files[0];
    if (file) {
        updateProfileImage(file);
    }
}

function loadUserCoupons() {
    db.collection('coupons')
        .where('userEmail', '==', currentUser.email)
        .get()
        .then(querySnapshot => {
            let couponsHtml = '<ul class="coupon-list">';
            if (querySnapshot.empty) {
                couponsHtml += '<li>No coupons found</li>';
            } else {
                querySnapshot.forEach(doc => {
                    const coupon = doc.data();
                    const couponId = doc.id;
                    const createdAt = coupon.createdAt?.toDate() || new Date();
                    const expirationTime = new Date(createdAt.getTime() + 48 * 60 * 60 * 1000);
                    const isExpired = Date.now() > expirationTime || coupon.used;
                    const discountPercentage = Math.floor(Math.random() * 15) + 1;

                    couponsHtml += `
                        <li id="coupon-${couponId}" class="coupon-item ${isExpired ? 'expired' : ''}">
                            <span class="coupon-code">${coupon.code}</span>
                            <span class="coupon-discount">${discountPercentage}% OFF</span>
                            <span class="coupon-status">${isExpired ? 'Expired' : 'Available'}</span>
                            <span class="coupon-expiry">${isExpired ? 'Expired' : getTimeLeft(expirationTime)}</span>
                            ${isExpired ? `<button onclick="deleteCoupon('${couponId}')" class="delete-btn">Delete</button>` : ''}
                        </li>
                    `;
                });
            }
            couponsHtml += '</ul>';
            document.getElementById('user-coupons').innerHTML = couponsHtml;
        })
        .catch(error => {
            showError(handleFirebaseError(error, 'loading coupons'));
        });
}

function getTimeLeft(expirationTime) {
    const timeLeft = expirationTime - Date.now();
    if (timeLeft <= 0) return 'Expired';
    
    const hours = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
}

function deleteCoupon(couponId) {
    if (confirm('Are you sure you want to delete this coupon?')) {
        showLoading(true);
        db.collection('coupons').doc(couponId).delete()
            .then(() => {
                showSuccess('Coupon deleted');
                loadUserCoupons();
            })
            .catch(error => {
                showError(handleFirebaseError(error, 'deleting coupon'));
            })
            .finally(() => showLoading(false));
    }
}

function editProfile(field) {
    if (field === 'password') {
        showReauthenticationForm();
    } else {
        const fieldValue = document.querySelector(`.field-value:nth-child(2)`);
        const currentValue = fieldValue.textContent;
        
        const form = document.createElement('form');
        form.className = 'edit-form';
        form.innerHTML = `
            <input type="text" id="edit-${field}" value="${currentValue}">
            <button type="submit">Save</button>
            <button type="button" onclick="cancelEdit()">Cancel</button>
        `;
        
        form.onsubmit = (e) => {
            e.preventDefault();
            const newValue = sanitizeInput(document.getElementById(`edit-${field}`).value);
            updateProfile({ [field]: newValue });
        };
        
        fieldValue.parentNode.insertBefore(form, fieldValue.nextSibling);
        fieldValue.style.display = 'none';
    }
}

function showReauthenticationForm() {
    document.getElementById('content').innerHTML = `
        <div class="reauthentication-form">
            <h3>Re-enter Password</h3>
            <input type="password" id="reauthentication-password" placeholder="Current Password">
            <button onclick="reauthenticateUser()">Confirm</button>
        </div>
    `;
}

function reauthenticateUser() {
    const password = document.getElementById('reauthentication-password').value;
    const credential = firebase.auth.EmailAuthProvider.credential(currentUser.email, password);
    
    showLoading(true);
    currentUser.reauthenticateWithCredential(credential)
        .then(() => {
            showPasswordChangeForm();
        })
        .catch((error) => {
            showError(handleFirebaseError(error, 'reauthentication'));
        })
        .finally(() => showLoading(false));
}

function showPasswordChangeForm() {
    document.getElementById('content').innerHTML = `
        <div class="password-change-form">
            <h3>New Password</h3>
            <input type="password" id="new-password" placeholder="New Password">
            <input type="password" id="confirm-new-password" placeholder="Confirm">
            <button onclick="changePassword()">Change</button>
        </div>
    `;
}

function changePassword() {
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-new-password').value;
    
    if (newPassword !== confirmPassword) {
        showError('Passwords do not match');
        return;
    }
    
    showLoading(true);
    currentUser.updatePassword(newPassword)
        .then(() => {
            showSuccess('Password updated');
            showProfile();
        })
        .catch(error => {
            showError(handleFirebaseError(error, 'password update'));
        })
        .finally(() => showLoading(false));
}

function updateProfile(updates) {
    showLoading(true);
    const userRef = db.collection('users').doc(currentUser.uid);
    currentUser.updateProfile(updates)
        .then(() => userRef.update(updates))
        .then(() => {
            showSuccess('Profile updated');
            showProfile();
        })
        .catch(error => {
            showError(handleFirebaseError(error, 'profile update'));
        })
        .finally(() => showLoading(false));
}

function uploadProfileImage(user, imageFile) {
    showLoading(true);
    const storageRef = storage.ref('profile_images/' + user.uid + '/' + imageFile.name);
    return storageRef.put(imageFile)
        .then(() => storageRef.getDownloadURL())
        .then(url => {
            return Promise.all([
                user.updateProfile({photoURL: url}),
                db.collection('users').doc(user.uid).update({photoURL: url})
            ]);
        })
        .then(() => {
            showSuccess('Profile image updated');
            return user;
        })
        .catch(error => {
            showError(handleFirebaseError(error, 'image upload'));
        })
        .finally(() => showLoading(false));
}

function updateProfileImage(file) {
    showLoading(true);
    const storageRef = storage.ref('profile_images/' + currentUser.uid + '/' + file.name);
    storageRef.put(file)
        .then(() => storageRef.getDownloadURL())
        .then(url => {
            return Promise.all([
                currentUser.updateProfile({photoURL: url}),
                db.collection('users').doc(currentUser.uid).update({photoURL: url})
            ]);
        })
        .then(() => {
            showSuccess('Profile image updated');
            document.getElementById('profile-image').src = currentUser.photoURL;
        })
        .catch(error => {
            showError(handleFirebaseError(error, 'image update'));
        })
        .finally(() => showLoading(false));
}

// Admin Functions
function showAdminPanel() {
    if (!currentUser) {
        showError('Please log in');
        return;
    }
    
    showLoading(true);
    db.collection('users').doc(currentUser.uid).get().then(doc => {
        if (doc.exists && doc.data().isAdmin) {
            document.getElementById('content').innerHTML = `
                <h2>Admin Panel</h2>
                <button onclick="showAllUsers()" class="glow-button">Show Users</button>
                <button onclick="migrateExistingUsers()" class="glow-button">Migrate Users</button>
                <div id="product-form-container">
                    <h3 id="form-title">Add Product</h3>
                    <form id="add-product-form">
                        <input type="hidden" id="product-id">
                        <input type="text" id="product-name" placeholder="Product Name" required>
                        <textarea id="product-description" placeholder="Description" required></textarea>
                        <input type="number" id="product-price" placeholder="Price" step="0.01" required>
                        <input type="number" id="product-stock" placeholder="Stock" min="0" required>
                        <input type="file" id="product-image" accept="image/*">
                        <div id="current-image-container" style="display: none;">
                            <img id="current-image" style="max-width: 200px;">
                        </div>
                        <button type="submit" class="glow-button" id="form-submit-btn">Add</button>
                        <button type="button" class="glow-button" id="cancel-edit-btn" style="display: none;" onclick="cancelEdit()">Cancel</button>
                    </form>
                </div>
                <div id="product-list">
                    <h3>Products</h3>
                    <ul id="admin-product-list"></ul>
                </div>
            `;
            
            document.getElementById('add-product-form').addEventListener('submit', function(e) {
                e.preventDefault();
                const productId = document.getElementById('product-id').value;
                if (productId) {
                    updateProduct(productId);
                } else {
                    addProduct();
                }
            });
            updateAdminProductList();
        } else {
            showError('Admin access required');
        }
    }).catch(error => {
        showError(handleFirebaseError(error, 'admin panel'));
    }).finally(() => showLoading(false));
}

function validateProductForm() {
    const name = document.getElementById('product-name').value.trim();
    const description = document.getElementById('product-description').value.trim();
    const price = document.getElementById('product-price').value;
    const stock = document.getElementById('product-stock').value;

    if (name.length < 3) {
        showError('Name must be at least 3 characters');
        return false;
    }
    if (description.length < 10) {
        showError('Description must be at least 10 characters');
        return false;
    }
    if (price <= 0 || isNaN(price)) {
        showError('Price must be a positive number');
        return false;
    }
    if (stock < 0 || isNaN(stock)) {
        showError('Stock must be a non-negative number');
        return false;
    }
    return true;
}

function addProduct() {
    if (!validateProductForm()) return;
    
    console.log('Adding product...');
    console.log('Current User:', currentUser);
    
    if (!currentUser) {
        showError('Please log in as admin');
        return;
    }

    showLoading(true);
    const name = sanitizeInput(document.getElementById('product-name').value.trim());
    const description = sanitizeInput(document.getElementById('product-description').value.trim());
    const price = document.getElementById('product-price').value;
    const stock = document.getElementById('product-stock').value;
    const imageFile = document.getElementById('product-image').files[0];
    
    if (!imageFile) {
        showError('Please select an image');
        showLoading(false);
        return;
    }

    // Check admin status
    db.collection('users').doc(currentUser.uid).get()
        .then(doc => {
            if (!doc.exists) {
                throw new Error('User document not found');
            }
            console.log('User data:', doc.data());
            if (!doc.data().isAdmin) {
                throw new Error('Admin privileges required');
            }

            const fileName = Date.now() + '_' + imageFile.name;
            const storageRef = storage.ref('product-images/' + fileName);
            console.log('Uploading to:', storageRef.fullPath);
            
            return storageRef.put(imageFile);
        })
        .then(snapshot => {
            console.log('Upload successful:', snapshot);
            return snapshot.ref.getDownloadURL();
        })
        .then(url => {
            console.log('Download URL:', url);
            return db.collection('products').add({
                name,
                description,
                price: parseFloat(price).toFixed(2),
                stock: parseInt(stock),
                image: url,
                searchTerms: name.toLowerCase().split(' ').concat(description.toLowerCase().split(' '))
            });
        })
        .then(docRef => {
            console.log('Product added with ID:', docRef.id);
            showSuccess('Product added successfully');
            document.getElementById('add-product-form').reset();
            updateAdminProductList();
        })
        .catch(error => {
            console.error('Error adding product:', error);
            showError(handleFirebaseError(error, 'adding product'));
        })
        .finally(() => {
            showLoading(false);
        });
}

function updateAdminProductList() {
    showLoading(true);
    const list = document.getElementById('admin-product-list');
    list.innerHTML = '';
    db.collection('products').get().then((querySnapshot) => {
        querySnapshot.forEach((doc) => {
            const product = doc.data();
            const li = document.createElement('li');
            li.innerHTML = `
                <img src="${product.image}" alt="${product.name}" style="width: 50px;">
                <div class="product-info">
                    <strong>${product.name}</strong> - â‚¹${product.price} (Stock: ${product.stock})
                    <p>${product.description}</p>
                </div>
                <div class="product-actions">
                    <button onclick="editProduct('${doc.id}')" class="edit-btn">Edit</button>
                    <button onclick="deleteProduct('${doc.id}')" class="delete-btn">Delete</button>
                </div>
            `;
            list.appendChild(li);
        });
    }).catch(error => {
        showError(handleFirebaseError(error, 'loading products'));
    }).finally(() => showLoading(false));
}

function editProduct(productId) {
    showLoading(true);
    db.collection('products').doc(productId).get().then((doc) => {
        if (doc.exists) {
            const product = doc.data();
            document.getElementById('form-title').textContent = 'Edit Product';
            document.getElementById('form-submit-btn').textContent = 'Update';
            document.getElementById('product-id').value = productId;
            document.getElementById('product-name').value = product.name;
            document.getElementById('product-description').value = product.description;
            document.getElementById('product-price').value = product.price;
            document.getElementById('product-stock').value = product.stock;
            document.getElementById('current-image').src = product.image;
            document.getElementById('current-image-container').style.display = 'block';
            document.getElementById('product-image').removeAttribute('required');
            document.getElementById('cancel-edit-btn').style.display = 'inline-block';
        }
    }).catch(error => {
        showError(handleFirebaseError(error, 'editing product'));
    }).finally(() => showLoading(false));
}

function updateProduct(productId) {
    if (!validateProductForm()) return;
    
    showLoading(true);
    const name = sanitizeInput(document.getElementById('product-name').value.trim());
    const description = sanitizeInput(document.getElementById('product-description').value.trim());
    const price = document.getElementById('product-price').value;
    const stock = document.getElementById('product-stock').value;
    const imageFile = document.getElementById('product-image').files[0];
    
    let updatePromise;
    if (imageFile) {
        const storageRef = storage.ref('product-images/' + Date.now() + '_' + imageFile.name);
        updatePromise = storageRef.put(imageFile)
            .then(() => storageRef.getDownloadURL())
            .then(url => {
                return db.collection('products').doc(productId).update({
                    name,
                    description,
                    price: parseFloat(price).toFixed(2),
                    stock: parseInt(stock),
                    image: url,
                    searchTerms: name.toLowerCase().split(' ').concat(description.toLowerCase().split(' '))
                });
            });
    } else {
        updatePromise = db.collection('products').doc(productId).update({
            name,
            description,
            price: parseFloat(price).toFixed(2),
            stock: parseInt(stock),
            searchTerms: name.toLowerCase().split(' ').concat(description.toLowerCase().split(' '))
        });
    }
    
    updatePromise
        .then(() => {
            showSuccess('Product updated');
            cancelEdit();
            updateAdminProductList();
        })
        .catch(error => {
            showError(handleFirebaseError(error, 'updating product'));
        })
        .finally(() => showLoading(false));
}

function deleteProduct(productId) {
    if (confirm('Are you sure you want to delete this product?')) {
        showLoading(true);
        db.collection('products').doc(productId).delete()
            .then(() => {
                showSuccess('Product deleted');
                updateAdminProductList();
            })
            .catch(error => {
                showError(handleFirebaseError(error, 'deleting product'));
            })
            .finally(() => showLoading(false));
    }
}

function cancelEdit() {
    document.getElementById('form-title').textContent = 'Add Product';
    document.getElementById('form-submit-btn').textContent = 'Add';
    document.getElementById('add-product-form').reset();
    document.getElementById('product-id').value = '';
    document.getElementById('current-image-container').style.display = 'none';
    document.getElementById('cancel-edit-btn').style.display = 'none';
    document.getElementById('product-image').setAttribute('required', 'required');
}

function showAllUsers() {
    showLoading(true);
    document.getElementById('content').innerHTML = '<h2>All Users</h2><div id="all-users-container"></div>';
    const usersContainer = document.getElementById('all-users-container');
    
    db.collection('users').get().then(snapshot => {
        let usersHTML = '<table class="users-table"><thead><tr><th>Photo</th><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead><tbody>';
        snapshot.forEach(doc => {
            const user = doc.data();
            usersHTML += `
                <tr id="user-${doc.id}">
                    <td><img src="${user.photoURL || 'https://via.placeholder.com/50'}" alt="Profile" class="user-profile-picture"></td>
                    <td>${user.name || 'N/A'}</td>
                    <td>${user.email}</td>
                    <td>${user.isAdmin ? 'Admin' : 'Customer'}</td>
                    <td>
                        <button onclick="viewUserDetails('${doc.id}')" class="view-btn">View</button>
                        ${!user.isAdmin ? `<button onclick="deleteUser('${doc.id}')" class="delete-btn">Delete</button>` : ''}
                    </td>
                </tr>
            `;
        });
        usersHTML += '</tbody></table>';
        usersContainer.innerHTML = usersHTML;
    }).catch(error => {
        showError(handleFirebaseError(error, 'loading users'));
    }).finally(() => showLoading(false));
}

function viewUserDetails(userId) {
    showLoading(true);
    db.collection('users').doc(userId).get().then((doc) => {
        if (doc.exists) {
            const userData = doc.data();
            const joinedDate = userData.createdAt?.toDate().toLocaleDateString() || 'N/A';
            document.getElementById('content').innerHTML = `
                <div class="user-details">
                    <h3>User Details</h3>
                    <img src="${userData.photoURL || 'https://via.placeholder.com/150'}" alt="${userData.name}" class="user-profile-picture-large">
                    <p><strong>Name:</strong> ${userData.name || 'N/A'}</p>
                    <p><strong>Email:</strong> ${userData.email}</p>
                    <p><strong>Type:</strong> ${userData.isAdmin ? 'Admin' : 'Customer'}</p>
                    <p><strong>Joined:</strong> ${joinedDate}</p>
                    ${!userData.isAdmin ? `<button onclick="deleteUser('${doc.id}')" class="delete-btn">Delete</button>` : ''}
                    <button onclick="showAllUsers()" class="glow-button">Back</button>
                </div>
            `;
        }
    }).catch(error => {
        showError(handleFirebaseError(error, 'viewing user'));
    }).finally(() => showLoading(false));
}

function deleteUser(userId) {
    if (confirm('Are you sure you want to delete this user?')) {
        showLoading(true);
        db.collection('users').doc(userId).delete()
            .then(() => {
                showSuccess('User deleted');
                showAllUsers();
            })
            .catch(error => {
                showError(handleFirebaseError(error, 'deleting user'));
            })
            .finally(() => showLoading(false));
    }
}

function migrateExistingUsers() {
    showLoading(true);
    db.collection('users').get().then((snapshot) => {
        const batch = db.batch();
        snapshot.docs.forEach((doc) => {
            if (!doc.data().createdAt) {
                batch.update(doc.ref, {
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        });
        return batch.commit();
    }).then(() => {
        showSuccess('Users migrated');
    }).catch(error => {
        showError(handleFirebaseError(error, 'migrating users'));
    }).finally(() => showLoading(false));
}

// Owner Functions
function showOwnerPanel() {
    document.getElementById('content').innerHTML = `
        <h2>Owner Information</h2>
        <div class="owner-info">
            <div class="owner-content">
                <div class="owner-image-container" id="tilt-container">
                    <img src="owner_image.jpg" alt="Gulshan Goel" class="owner-image" id="tilt-image">
                </div>
                <div class="owner-details">
                    <h3>Gulshan Goel</h3>
                    <p>Founder and Owner</p>
                    <p>20+ years in agriculture</p>
                </div>
            </div>
        </div>
    `;
    setupTiltEffect();
}

// Utility Functions
function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = show ? 'flex' : 'none';
}

function showError(message) {
    const container = document.getElementById('message-container');
    const error = document.createElement('div');
    error.className = 'error message';
    error.textContent = message;
    container.appendChild(error);
    setTimeout(() => error.remove(), 5000);
}

function showSuccess(message) {
    const container = document.getElementById('message-container');
    const success = document.createElement('div');
    success.className = 'success message';
    success.textContent = message;
    container.appendChild(success);
    setTimeout(() => success.remove(), 5000);
}

function updateSeasonDisplay() {
    const seasonDisplay = document.getElementById('season-display');
    const month = new Date().getMonth();
    let currentSeason = '';

    if (month >= 5 && month <= 8) currentSeason = 'Kharif Season';
    else if (month >= 9 && month <= 11) currentSeason = 'Rabi Sowing';
    else if (month >= 0 && month <= 2) currentSeason = 'Rabi Growing';
    else if (month >= 2 && month <= 4) currentSeason = 'Rabi Harvest';
    else currentSeason = 'Kharif Prep';

    seasonDisplay.innerHTML = `
        <h3>Current Season:</h3>
        <div class="scrolling-text-container">
            <div class="scrolling-text">${currentSeason}</div>
        </div>
    `;
}

function setupTiltEffect() {
    const container = document.getElementById('tilt-container');
    const image = document.getElementById('tilt-image');
    
    if (!container || !image) return;

    const maxTilt = 10;
    container.addEventListener('mousemove', (e) => {
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        const percentX = (x - centerX) / centerX;
        const percentY = -((y - centerY) / centerY);

        const tiltX = maxTilt * percentY;
        const tiltY = maxTilt * percentX;

        image.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale3d(1.05, 1.05, 1.05)`;
    });

    container.addEventListener('mouseleave', () => {
        image.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) scale3d(1, 1, 1)';
    });
}

function logout() {
    showLoading(true);
    auth.signOut()
        .then(() => {
            cart = [];
            showSuccess('Logged out successfully');
        })
        .catch(error => {
            showError(handleFirebaseError(error, 'logout'));
        })
        .finally(() => showLoading(false));
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    updateCartCount();
    initializeTheme();
    updateSeasonDisplay();
});
