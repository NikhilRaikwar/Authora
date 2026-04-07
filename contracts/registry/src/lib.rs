#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Map, String, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    ServiceAlreadyExists = 1,
    ServiceNotFound = 2,
    InvalidUrl = 3,
    InvalidName = 4,
    InvalidPrice = 5,
    NotAuthorized = 6,
    LimitExceeded = 7,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServiceEntry {
    pub url: String,
    pub name: String,
    pub description: String,
    pub price_usdc: i128,
    pub input_schema: String,
    pub output_schema: String,
    pub owner: Address,
    pub verified: bool,
    pub total_payments: u64,
}

#[contract]
pub struct AuthoraRegistry;

const SERVICES: soroban_sdk::Symbol = symbol_short!("services");
const COUNT: soroban_sdk::Symbol = symbol_short!("count");
const URLS: soroban_sdk::Symbol = symbol_short!("urls");

#[contractimpl]
impl AuthoraRegistry {
    /// Registers a new service in the Authora registry.
    pub fn register_service(env: Env, caller: Address, mut entry: ServiceEntry) -> Result<(), Error> {
        caller.require_auth();
        
        // Initial state for new services
        entry.owner = caller.clone();
        entry.verified = false;
        entry.total_payments = 0;

        // Validation
        if entry.url.len() == 0 { return Err(Error::InvalidUrl); }
        if entry.name.len() == 0 || entry.name.len() > 64 { return Err(Error::InvalidName); }
        if entry.description.len() > 256 { return Err(Error::InvalidPrice); } // Re-using error for now if description is too long
        if entry.price_usdc <= 0 { return Err(Error::InvalidPrice); }

        let mut services: Map<String, ServiceEntry> = env.storage().persistent().get(&SERVICES).unwrap_or(Map::new(&env));
        let mut urls: Vec<String> = env.storage().persistent().get(&URLS).unwrap_or(Vec::new(&env));

        if services.contains_key(entry.url.clone()) {
            return Err(Error::ServiceAlreadyExists);
        }

        services.set(entry.url.clone(), entry.clone());
        urls.push_back(entry.url.clone());

        env.storage().persistent().set(&SERVICES, &services);
        env.storage().persistent().set(&URLS, &urls);
        env.storage().persistent().set(&COUNT, &(urls.len()));

        env.events().publish((symbol_short!("reg"), entry.url), caller);

        Ok(())
    }

    pub fn get_service(env: Env, url: String) -> Option<ServiceEntry> {
        let services: Map<String, ServiceEntry> = env.storage().persistent().get(&SERVICES).unwrap_or(Map::new(&env));
        services.get(url)
    }

    pub fn list_services(env: Env, offset: u32, limit: u32) -> Vec<ServiceEntry> {
        let urls: Vec<String> = env.storage().persistent().get(&URLS).unwrap_or(Vec::new(&env));
        let services: Map<String, ServiceEntry> = env.storage().persistent().get(&SERVICES).unwrap_or(Map::new(&env));
        
        let mut result = Vec::new(&env);
        let capped_limit = if limit > 50 { 50 } else { limit };
        let total = urls.len();

        for i in offset..(offset + capped_limit) {
            if i >= total { break; }
            if let Some(url) = urls.get(i) {
                if let Some(entry) = services.get(url) {
                    result.push_back(entry);
                }
            }
        }
        result
    }

    pub fn record_payment(env: Env, url: String, payer: Address) -> Result<(), Error> {
        // This would typically be called by an operator/facilitator admin
        // For simplicity in this base version, we perform the increment
        let mut services: Map<String, ServiceEntry> = env.storage().persistent().get(&SERVICES).unwrap_or(Map::new(&env));
        
        let mut entry = services.get(url.clone()).ok_or(Error::ServiceNotFound)?;
        entry.total_payments += 1;
        entry.verified = true; // Set verified true on first payment

        services.set(url, entry);
        env.storage().persistent().set(&SERVICES, &services);
        
        Ok(())
    }

    pub fn remove_service(env: Env, caller: Address, url: String) -> Result<(), Error> {
        caller.require_auth();
        
        let mut services: Map<String, ServiceEntry> = env.storage().persistent().get(&SERVICES).unwrap_or(Map::new(&env));
        let mut urls: Vec<String> = env.storage().persistent().get(&URLS).unwrap_or(Vec::new(&env));
        
        let entry = services.get(url.clone()).ok_or(Error::ServiceNotFound)?;
        if entry.owner != caller {
            return Err(Error::NotAuthorized);
        }

        services.remove(url.clone());
        
        // Update URL list (O(n) but necessary for pagination with Map)
        let mut new_urls = Vec::new(&env);
        for i in 0..urls.len() {
            let u = urls.get(i).unwrap();
            if u != url {
                new_urls.push_back(u);
            }
        }

        env.storage().persistent().set(&SERVICES, &services);
        env.storage().persistent().set(&URLS, &new_urls);
        env.storage().persistent().set(&COUNT, &(new_urls.len()));

        Ok(())
    }

    pub fn service_count(env: Env) -> u32 {
        env.storage().persistent().get(&COUNT).unwrap_or(0)
    }
}
